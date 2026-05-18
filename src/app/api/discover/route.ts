import { NextRequest, NextResponse } from 'next/server';
import { getTMDBClient, getRadarrClient, getSonarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { annotateDiscoverItems, dedupeDiscoverItems, normalizeTmdbItem } from '@/lib/discover';
import { TmdbRateLimitError } from '@/lib/tmdb-client';
import type {
  DiscoverContentType,
  DiscoverFilters,
  DiscoverItem,
  DiscoverResponse,
  RadarrMovie,
  SonarrSeries,
} from '@/types';
import type { TmdbDiscoverParams, TmdbListItem } from '@/lib/tmdb-client';
import { withApiLogging } from '@/lib/api-logger';
type DiscoverSections = NonNullable<DiscoverResponse['sections']>;

const SECTION_SORT_OVERRIDES: Record<string, Partial<{ sortBy: string; sortOrder: 'asc' | 'desc'; contentType: DiscoverContentType }>> = {
  trending: { sortBy: 'trending', contentType: 'all' },
  trending_movies: { sortBy: 'trending', contentType: 'movie' },
  trending_tv: { sortBy: 'trending', contentType: 'show' },
  popular_all: { sortBy: 'popular', contentType: 'all' },
  popular_movies: { sortBy: 'popular', contentType: 'movie' },
  popular_series: { sortBy: 'popular', contentType: 'show' },
  upcoming_movies: { sortBy: 'upcoming', contentType: 'movie' },
  upcoming_series: { sortBy: 'upcoming', contentType: 'show' },
  highly_rated: { sortBy: 'highlyRated', contentType: 'all' },
  most_loved: { sortBy: 'mostLoved', contentType: 'all' },
  now_playing: { sortBy: 'now_playing', contentType: 'movie' },
  airing_today: { sortBy: 'airing_today', contentType: 'show' },
  top_rated_movies: { sortBy: 'top_rated_movies', contentType: 'movie' },
  top_rated_tv: { sortBy: 'top_rated_tv', contentType: 'show' },
};

const EMPTY_LIST_RESPONSE = {
  page: 1,
  total_pages: 1,
  total_results: 0,
  results: [] as TmdbListItem[],
};
const SECTIONS_CACHE_TTL_MS = 5 * 60 * 1000;
const SECTION_MEDIA_DEFAULT = 20;
// Each TMDB list endpoint returns 20 items per page. The Discover client picks
// an item count based on viewport width (max ~46 items on 4K), so 3 pages
// (60 items cached per section) is enough headroom while keeping the TMDB
// fanout small. Pages are fetched in parallel and cached server-side for 5 min.
const SECTION_TMDB_PAGES = 3;
const SECTION_MEDIA_MAX = SECTION_TMDB_PAGES * 20;
const BROWSE_LIMIT_MAX = 60;

async function fetchTmdbPages<R extends { page: number; total_pages: number; total_results: number; results: TmdbListItem[] }>(
  fn: (page: number) => Promise<R>,
  pages: number = SECTION_TMDB_PAGES,
): Promise<R> {
  const results = await Promise.all(Array.from({ length: pages }, (_, i) => fn(i + 1)));
  const first = results[0];
  return {
    ...first,
    page: 1,
    total_pages: first?.total_pages ?? 1,
    total_results: first?.total_results ?? 0,
    results: results.flatMap((r) => r.results),
  } as R;
}

function clampInt(value: string | null, min: number, max: number, fallback: number): number {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

let sectionsCache:
  | {
      data: DiscoverSections;
      expiresAt: number;
    }
  | null = null;

function parseNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseNumberList(value: string | null): number[] | undefined {
  if (!value) return undefined;
  const list = value
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v));
  return list.length ? list : undefined;
}

function asSort(sortBy: string | null): string {
  return sortBy || 'trending';
}

function asSortOrder(sortOrder: string | null): 'asc' | 'desc' {
  return sortOrder === 'asc' ? 'asc' : 'desc';
}

function asContentType(contentType: string | null): DiscoverContentType {
  if (contentType === 'movie' || contentType === 'show') return contentType;
  return 'all';
}

function asReleaseState(value: string | null): DiscoverFilters['releaseState'] | undefined {
  if (value === 'released' || value === 'upcoming' || value === 'airing' || value === 'ended') {
    return value;
  }
  return undefined;
}

async function safeTmdb<T>(
  label: string,
  partialFailures: Set<string>,
  fn: () => Promise<T>,
  fallback: T
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof TmdbRateLimitError) throw error;
    partialFailures.add(label);
    return fallback;
  }
}

function applySortPreset(sortBy: string, input: TmdbDiscoverParams): TmdbDiscoverParams {
  switch (sortBy) {
    case 'highlyRated':
      return {
        ...input,
        sortBy: 'vote_average',
        sortOrder: 'desc',
        voteCountMin: Math.max(input.voteCountMin || 0, 200),
      };
    case 'mostLoved':
      return {
        ...input,
        sortBy: 'vote_average',
        sortOrder: 'desc',
        voteCountMin: Math.max(input.voteCountMin || 0, 1200),
      };
    case 'popular':
      return {
        ...input,
        sortBy: 'popularity',
        sortOrder: input.sortOrder || 'desc',
      };
    case 'upcoming':
      return {
        ...input,
        sortBy: 'popularity',
        sortOrder: 'desc',
        releaseState: 'upcoming',
        includeAdult: false,
      };
    default:
      return {
        ...input,
        sortBy: input.sortBy || 'popularity',
        sortOrder: input.sortOrder || 'desc',
      };
  }
}

function parseFilters(searchParams: URLSearchParams): DiscoverFilters {
  const withCast = parseNumberList(searchParams.get('withCast'));
  const withCrew = parseNumberList(searchParams.get('withCrew'));
  const withPeople = parseNumberList(searchParams.get('with_people'))
    || ([...(withCast || []), ...(withCrew || [])].length
      ? [...new Set([...(withCast || []), ...(withCrew || [])])]
      : undefined);

  return {
    genres: parseNumberList(searchParams.get('genres')),
    yearFrom: parseNumber(searchParams.get('yearFrom')),
    yearTo: parseNumber(searchParams.get('yearTo')),
    runtimeMin: parseNumber(searchParams.get('runtimeMin')),
    runtimeMax: parseNumber(searchParams.get('runtimeMax')),
    language: searchParams.get('language') || undefined,
    region: searchParams.get('region') || undefined,
    ratingMin: parseNumber(searchParams.get('ratingMin')),
    ratingMax: parseNumber(searchParams.get('ratingMax')),
    voteCountMin: parseNumber(searchParams.get('voteCountMin')),
    providers: parseNumberList(searchParams.get('providers')),
    networks: parseNumberList(searchParams.get('networks')),
    companies: parseNumberList(searchParams.get('companies')),
    releaseState: asReleaseState(searchParams.get('releaseState')),
    withPeople,
    withCast,
    withCrew,
  };
}

function hasDiscoverFilters(filters: DiscoverFilters): boolean {
  return Boolean(
    (filters.genres && filters.genres.length > 0)
    || filters.yearFrom
    || filters.yearTo
    || filters.runtimeMin
    || filters.runtimeMax
    || filters.language
    || (filters.region && filters.region !== 'US')
    || filters.ratingMin !== undefined
    || filters.ratingMax !== undefined
    || filters.voteCountMin !== undefined
    || (filters.providers && filters.providers.length > 0)
    || (filters.networks && filters.networks.length > 0)
    || (filters.companies && filters.companies.length > 0)
    || filters.releaseState
    || (filters.withPeople && filters.withPeople.length > 0)
    || (filters.withCast && filters.withCast.length > 0)
    || (filters.withCrew && filters.withCrew.length > 0)
  );
}

function normalizeItems(results: TmdbListItem[], mediaType: 'all' | 'movie' | 'tv'): DiscoverItem[] {
  return results
    .map((item) => normalizeTmdbItem(item, mediaType))
    .filter((item): item is DiscoverItem => !!item);
}

async function getLibraries() {
  const [movies, series] = await Promise.all([
    (async () => {
      try {
        const client = await getRadarrClient();
        return await client.getMovies();
      } catch {
        return [] as RadarrMovie[];
      }
    })(),
    (async () => {
      try {
        const client = await getSonarrClient();
        return await client.getSeries();
      } catch {
        return [] as SonarrSeries[];
      }
    })(),
  ]);

  return { movies, series };
}

async function buildSections() {
  const tmdb = await getTMDBClient();
  const partialFailures = new Set<string>();

  const [
    trending,
    trendingMovies,
    trendingTv,
    popularMovies,
    popularSeries,
    upcomingMovies,
    upcomingSeries,
    movieGenres,
    tvGenres,
    movieProviders,
    tvProviders,
    nowPlaying,
    airingToday,
    topRatedMoviesData,
    topRatedTvData,
  ] = await Promise.all([
    safeTmdb('trending', partialFailures, () => fetchTmdbPages((p) => tmdb.trending('all', p)), EMPTY_LIST_RESPONSE),
    safeTmdb('trending_movies', partialFailures, () => fetchTmdbPages((p) => tmdb.trending('movie', p)), EMPTY_LIST_RESPONSE),
    safeTmdb('trending_tv', partialFailures, () => fetchTmdbPages((p) => tmdb.trending('tv', p)), EMPTY_LIST_RESPONSE),
    safeTmdb('popular_movies', partialFailures, () => fetchTmdbPages((p) => tmdb.discoverMovie({ page: p, sortBy: 'popularity', sortOrder: 'desc' })), EMPTY_LIST_RESPONSE),
    safeTmdb('popular_series', partialFailures, () => fetchTmdbPages((p) => tmdb.discoverTv({ page: p, sortBy: 'popularity', sortOrder: 'desc' })), EMPTY_LIST_RESPONSE),
    safeTmdb('upcoming_movies', partialFailures, () => fetchTmdbPages((p) => tmdb.discoverMovie({ page: p, sortBy: 'popularity', sortOrder: 'desc', releaseState: 'upcoming' })), EMPTY_LIST_RESPONSE),
    safeTmdb('upcoming_series', partialFailures, () => fetchTmdbPages((p) => tmdb.discoverTv({ page: p, sortBy: 'popularity', sortOrder: 'desc', releaseState: 'upcoming' })), EMPTY_LIST_RESPONSE),
    safeTmdb('movie_genres', partialFailures, () => tmdb.movieGenres(), []),
    safeTmdb('series_genres', partialFailures, () => tmdb.tvGenres(), []),
    safeTmdb('movie_providers', partialFailures, () => tmdb.movieWatchProviders('US'), []),
    safeTmdb('tv_providers', partialFailures, () => tmdb.tvWatchProviders('US'), []),
    safeTmdb('now_playing', partialFailures, () => fetchTmdbPages((p) => tmdb.nowPlayingMovies(p, 'US')), EMPTY_LIST_RESPONSE),
    safeTmdb('airing_today', partialFailures, () => fetchTmdbPages((p) => tmdb.airingTodayTv(p)), EMPTY_LIST_RESPONSE),
    safeTmdb('top_rated_movies', partialFailures, () => fetchTmdbPages((p) => tmdb.topRatedMovies(p)), EMPTY_LIST_RESPONSE),
    safeTmdb('top_rated_tv', partialFailures, () => fetchTmdbPages((p) => tmdb.topRatedTv(p)), EMPTY_LIST_RESPONSE),
  ]);

  const popularAllItems = dedupeDiscoverItems([
    ...normalizeItems(popularMovies.results, 'movie'),
    ...normalizeItems(popularSeries.results, 'tv'),
  ]).sort((a, b) => b.popularity - a.popularity);

  const combinedGenres = [
    ...movieGenres.map((genre) => ({ ...genre, type: 'movie' as const })),
    ...tvGenres.map((genre) => ({ ...genre, type: 'tv' as const })),
  ];

  const providers = [
    ...movieProviders.slice(0, 12).map((provider) => ({
      id: provider.provider_id,
      name: provider.provider_name,
      logoPath: provider.logo_path,
      displayPriority: provider.display_priority,
      type: 'movie' as const,
    })),
    ...tvProviders.slice(0, 12).map((provider) => ({
      id: provider.provider_id,
      name: provider.provider_name,
      logoPath: provider.logo_path,
      displayPriority: provider.display_priority,
      type: 'tv' as const,
    })),
  ];

  const sections: DiscoverSections = [
    {
      key: 'trending',
      title: 'Trending',
      type: 'media',
      mediaType: 'all',
      items: normalizeItems(trending.results, 'all').slice(0, SECTION_MEDIA_MAX),
    },
    {
      key: 'trending_movies',
      title: 'Trending Movies',
      type: 'media',
      mediaType: 'movie',
      items: normalizeItems(trendingMovies.results, 'movie').slice(0, SECTION_MEDIA_MAX),
    },
    {
      key: 'trending_tv',
      title: 'Trending TV',
      type: 'media',
      mediaType: 'tv',
      items: normalizeItems(trendingTv.results, 'tv').slice(0, SECTION_MEDIA_MAX),
    },
    {
      key: 'popular_all',
      title: 'Popular',
      type: 'media',
      mediaType: 'all',
      items: popularAllItems.slice(0, SECTION_MEDIA_MAX),
    },
    {
      key: 'now_playing',
      title: 'Now in Theaters',
      type: 'media',
      mediaType: 'movie',
      items: normalizeItems(nowPlaying.results, 'movie').slice(0, SECTION_MEDIA_MAX),
    },
    {
      key: 'popular_movies',
      title: 'Popular Movies',
      type: 'media',
      mediaType: 'movie',
      items: normalizeItems(popularMovies.results, 'movie').slice(0, SECTION_MEDIA_MAX),
    },
    {
      key: 'movie_genres',
      title: 'Movie Genres',
      type: 'genre',
      mediaType: 'movie',
      items: combinedGenres.filter((g) => g.type === 'movie').slice(0, 18),
    },
    {
      key: 'upcoming_movies',
      title: 'Upcoming Movies',
      type: 'media',
      mediaType: 'movie',
      items: normalizeItems(upcomingMovies.results, 'movie').slice(0, SECTION_MEDIA_MAX),
    },
    {
      key: 'providers',
      title: 'Studios & Platforms',
      type: 'provider',
      mediaType: 'all',
      items: providers,
    },
    {
      key: 'airing_today',
      title: 'Airing Today',
      type: 'media',
      mediaType: 'tv',
      items: normalizeItems(airingToday.results, 'tv').slice(0, SECTION_MEDIA_MAX),
    },
    {
      key: 'popular_series',
      title: 'Popular Series',
      type: 'media',
      mediaType: 'tv',
      items: normalizeItems(popularSeries.results, 'tv').slice(0, SECTION_MEDIA_MAX),
    },
    {
      key: 'series_genres',
      title: 'Series Genres',
      type: 'genre',
      mediaType: 'tv',
      items: combinedGenres.filter((g) => g.type === 'tv').slice(0, 18),
    },
    {
      key: 'upcoming_series',
      title: 'Upcoming Series',
      type: 'media',
      mediaType: 'tv',
      items: normalizeItems(upcomingSeries.results, 'tv').slice(0, SECTION_MEDIA_MAX),
    },
    {
      key: 'top_rated_movies',
      title: 'Top Rated Movies',
      type: 'media',
      mediaType: 'movie',
      items: normalizeItems(topRatedMoviesData.results, 'movie').slice(0, SECTION_MEDIA_MAX),
    },
    {
      key: 'top_rated_tv',
      title: 'Top Rated TV',
      type: 'media',
      mediaType: 'tv',
      items: normalizeItems(topRatedTvData.results, 'tv').slice(0, SECTION_MEDIA_MAX),
    },
  ];

  const { movies, series } = await getLibraries();

  const normalizedSections: DiscoverSections = sections.map((section) => {
    if (section?.type !== 'media') return section;

    return {
      ...section,
      items: annotateDiscoverItems(section.items as DiscoverItem[], movies, series),
    };
  });

  return {
    sections: normalizedSections,
    partialFailures: [...partialFailures],
  };
}

function hasMediaItems(sections: DiscoverSections): boolean {
  return sections.some(
    (section) => section.type === 'media' && (section.items as DiscoverItem[]).length > 0
  );
}

async function searchItems(params: {
  q: string;
  page: number;
  contentType: DiscoverContentType;
}) {
  const tmdb = await getTMDBClient();

  const query = params.q.trim();
  if (!query) {
    return { page: 1, total_pages: 1, total_results: 0, results: [] as TmdbListItem[] };
  }

  if (params.contentType === 'movie') {
    return tmdb.searchMovie(query, params.page);
  }

  if (params.contentType === 'show') {
    return tmdb.searchTv(query, params.page);
  }

  return tmdb.searchMulti(query, params.page);
}

async function discoverItems(params: {
  page: number;
  contentType: DiscoverContentType;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  filters: DiscoverFilters;
  section?: string | null;
}) {
  const tmdb = await getTMDBClient();
  const hasFilters = hasDiscoverFilters(params.filters);
  const effectiveSortBy = params.sortBy === 'trending' && hasFilters ? 'popular' : params.sortBy;

  if (params.section === 'now_playing' || effectiveSortBy === 'now_playing') {
    return { data: await tmdb.nowPlayingMovies(params.page, 'US'), mediaType: 'movie' as const };
  }

  if (params.section === 'airing_today' || effectiveSortBy === 'airing_today') {
    return { data: await tmdb.airingTodayTv(params.page), mediaType: 'tv' as const };
  }

  if (params.section === 'top_rated_movies' || effectiveSortBy === 'top_rated_movies') {
    return { data: await tmdb.topRatedMovies(params.page), mediaType: 'movie' as const };
  }

  if (params.section === 'top_rated_tv' || effectiveSortBy === 'top_rated_tv') {
    return { data: await tmdb.topRatedTv(params.page), mediaType: 'tv' as const };
  }

  if (effectiveSortBy === 'trending') {
    if (params.contentType === 'movie') {
      return { data: await tmdb.trending('movie', params.page), mediaType: 'movie' as const };
    }

    if (params.contentType === 'show') {
      return { data: await tmdb.trending('tv', params.page), mediaType: 'tv' as const };
    }

    return { data: await tmdb.trending('all', params.page), mediaType: 'all' as const };
  }

  const baseParams: TmdbDiscoverParams = {
    page: params.page,
    sortBy: effectiveSortBy,
    sortOrder: params.sortOrder,
    genres: params.filters.genres,
    yearFrom: params.filters.yearFrom,
    yearTo: params.filters.yearTo,
    runtimeMin: params.filters.runtimeMin,
    runtimeMax: params.filters.runtimeMax,
    language: params.filters.language,
    region: params.filters.region,
    ratingMin: params.filters.ratingMin,
    ratingMax: params.filters.ratingMax,
    voteCountMin: params.filters.voteCountMin,
    providers: params.filters.providers,
    networks: params.filters.networks,
    companies: params.filters.companies,
    releaseState: params.filters.releaseState,
    withPeople: params.filters.withPeople,
  };

  const preset = applySortPreset(effectiveSortBy, baseParams);

  if (params.contentType === 'movie') {
    return { data: await tmdb.discoverMovie(preset), mediaType: 'movie' as const };
  }

  if (params.contentType === 'show') {
    return {
      data: await tmdb.discoverTv({
        ...preset,
        sortBy: preset.sortBy === 'primary_release_date' ? 'first_air_date' : preset.sortBy,
      }),
      mediaType: 'tv' as const,
    };
  }

  const [movie, tv] = await Promise.all([
    tmdb.discoverMovie(preset),
    tmdb.discoverTv({
      ...preset,
      sortBy: preset.sortBy === 'primary_release_date' ? 'first_air_date' : preset.sortBy,
    }),
  ]);

  return {
    data: {
      page: params.page,
      total_pages: Math.max(movie.total_pages, tv.total_pages),
      total_results: movie.total_results + tv.total_results,
      results: [
        ...movie.results.map((item) => ({ ...item, media_type: 'movie' as const })),
        ...tv.results.map((item) => ({ ...item, media_type: 'tv' as const })),
      ],
    },
    mediaType: 'all' as const,
  };
}

async function getHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const mode = (searchParams.get('mode') || 'sections') as 'sections' | 'browse' | 'search';

    if (mode === 'sections') {
      const now = Date.now();
      const sectionsHeaders = {
        'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
      } as const;
      const perSectionLimit = clampInt(
        searchParams.get('perSectionLimit'),
        1,
        SECTION_MEDIA_MAX,
        SECTION_MEDIA_DEFAULT,
      );
      const applySectionLimit = (data: DiscoverSections): DiscoverSections =>
        perSectionLimit >= SECTION_MEDIA_MAX
          ? data
          : data.map((section) =>
              section.type === 'media'
                ? { ...section, items: (section.items as DiscoverItem[]).slice(0, perSectionLimit) }
                : section,
            );

      if (sectionsCache && now < sectionsCache.expiresAt) {
        return NextResponse.json(
          { mode: 'sections', sections: applySectionLimit(sectionsCache.data) } satisfies DiscoverResponse,
          { headers: sectionsHeaders }
        );
      }

      const { sections, partialFailures } = await buildSections();
      const freshHasMedia = hasMediaItems(sections);

      if (freshHasMedia) {
        sectionsCache = {
          data: sections,
          expiresAt: now + SECTIONS_CACHE_TTL_MS,
        };
      }

      if (partialFailures.length > 0) {
        console.warn(
          `[Discover] TMDB partial failures (${partialFailures.length}): ${partialFailures.join(', ')}`
        );
      }

      const fallbackSections = (!freshHasMedia && sectionsCache?.data) ? sectionsCache.data : sections;
      const body: DiscoverResponse = {
        mode: 'sections',
        sections: applySectionLimit(fallbackSections || []),
      };
      return NextResponse.json(body, { headers: sectionsHeaders });
    }

    const startPage = Math.max(1, parseNumber(searchParams.get('page')) ?? 1);
    const query = searchParams.get('q') || '';
    const section = searchParams.get('section');
    const limit = clampInt(searchParams.get('limit'), 1, BROWSE_LIMIT_MAX, 20);
    const TMDB_PAGE_SIZE = 20;
    const pageCount = Math.max(1, Math.ceil(limit / TMDB_PAGE_SIZE));

    const sectionOverride = section ? SECTION_SORT_OVERRIDES[section] : undefined;
    const contentType = sectionOverride?.contentType || asContentType(searchParams.get('contentType'));
    const sortBy = sectionOverride?.sortBy || asSort(searchParams.get('sortBy'));
    const sortOrder = sectionOverride?.sortOrder || asSortOrder(searchParams.get('sortOrder'));
    const filters = parseFilters(searchParams);

    const pages = Array.from({ length: pageCount }, (_, i) => startPage + i);
    const pageResults = await Promise.all(
      pages.map((page) =>
        mode === 'search' || query.trim()
          ? searchItems({ q: query, page, contentType })
          : discoverItems({ page, contentType, sortBy, sortOrder, filters, section }).then((res) => res.data),
      ),
    );
    const firstPage = pageResults[0];
    const combinedResults = pageResults.flatMap((r) => r.results);

    let items = normalizeItems(
      combinedResults,
      contentType === 'movie'
        ? 'movie'
        : contentType === 'show'
          ? 'tv'
          : 'all'
    );

    if (contentType === 'movie') {
      items = items.filter((item) => item.mediaType === 'movie');
    }

    if (contentType === 'show') {
      items = items.filter((item) => item.mediaType === 'tv');
    }

    if (!query && (sortBy === 'highlyRated' || sortBy === 'mostLoved')) {
      const voteFloor = sortBy === 'mostLoved' ? 1200 : 200;
      items = items.filter((item) => item.voteCount >= voteFloor);
      items = items.sort((a, b) => b.rating - a.rating || b.voteCount - a.voteCount);
    }

    items = dedupeDiscoverItems(items).slice(0, limit);

    const { movies, series } = await getLibraries();
    items = annotateDiscoverItems(items, movies, series);

    const body: DiscoverResponse = {
      mode: query.trim() ? 'search' : 'browse',
      page: firstPage.page,
      totalPages: firstPage.total_pages,
      totalResults: firstPage.total_results,
      items,
    };

    return NextResponse.json(body);
  } catch (error) {
    if (error instanceof TmdbRateLimitError) {
      return NextResponse.json(
        {
          error: 'TMDB rate limit reached',
          code: 'TMDB_RATE_LIMIT',
          retryAfterSeconds: error.retryAfterSeconds,
          retryAt: error.retryAt,
        },
        { status: 429 }
      );
    }

    const message = error instanceof Error ? error.message : 'Failed to load discover data';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/discover');
