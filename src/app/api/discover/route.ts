import { NextRequest, NextResponse } from 'next/server';
import { getTMDBClient, getRadarrClient, getSonarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { annotateDiscoverItems, dedupeDiscoverItems, normalizeTmdbItem, isJapaneseAnime } from '@/lib/discover';
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
type DiscoverSections = NonNullable<DiscoverResponse['sections']>;

const SECTION_SORT_OVERRIDES: Record<string, Partial<{ sortBy: string; sortOrder: 'asc' | 'desc'; contentType: DiscoverContentType }>> = {
  trending: { sortBy: 'trending', contentType: 'all' },
  popular_movies: { sortBy: 'popular', contentType: 'movie' },
  popular_series: { sortBy: 'popular', contentType: 'show' },
  popular_anime: { sortBy: 'popular', contentType: 'anime' },
  upcoming_movies: { sortBy: 'upcoming', contentType: 'movie', sortOrder: 'asc' },
  upcoming_series: { sortBy: 'upcoming', contentType: 'show', sortOrder: 'asc' },
  highly_rated: { sortBy: 'highlyRated', contentType: 'all' },
  most_loved: { sortBy: 'mostLoved', contentType: 'all' },
};

const EMPTY_LIST_RESPONSE = {
  page: 1,
  total_pages: 1,
  total_results: 0,
  results: [] as TmdbListItem[],
};
const SECTIONS_CACHE_TTL_MS = 5 * 60 * 1000;

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
  if (contentType === 'movie' || contentType === 'show' || contentType === 'anime') return contentType;
  return 'all';
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
  const today = new Date().toISOString().slice(0, 10);

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
        sortBy: 'primary_release_date',
        sortOrder: 'asc',
        releaseState: 'upcoming',
        yearFrom: input.yearFrom,
        yearTo: input.yearTo,
        query: input.query,
        includeAdult: false,
        region: input.region,
        language: input.language,
        ratingMin: input.ratingMin,
        ratingMax: input.ratingMax,
        voteCountMin: input.voteCountMin,
        providers: input.providers,
        runtimeMin: input.runtimeMin,
        runtimeMax: input.runtimeMax,
        genres: input.genres,
        networks: input.networks,
        anime: input.anime,
        page: input.page,
        // Helps relevance for upcoming browse with year-range defaults
        // while keeping user filters intact.
        ...(input.yearFrom ? {} : { yearFrom: Number(today.slice(0, 4)) }),
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
    releaseState: (searchParams.get('releaseState') as DiscoverFilters['releaseState']) || undefined,
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
    || filters.releaseState
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
    popularMovies,
    popularSeries,
    upcomingMovies,
    upcomingSeries,
    movieGenres,
    tvGenres,
    animeMovies,
    animeShows,
    movieProviders,
    tvProviders,
  ] = await Promise.all([
    safeTmdb('trending', partialFailures, () => tmdb.trending('all', 1), EMPTY_LIST_RESPONSE),
    safeTmdb('popular_movies', partialFailures, () => tmdb.discoverMovie({ page: 1, sortBy: 'popularity', sortOrder: 'desc' }), EMPTY_LIST_RESPONSE),
    safeTmdb('popular_series', partialFailures, () => tmdb.discoverTv({ page: 1, sortBy: 'popularity', sortOrder: 'desc' }), EMPTY_LIST_RESPONSE),
    safeTmdb('upcoming_movies', partialFailures, () => tmdb.discoverMovie({ page: 1, sortBy: 'primary_release_date', sortOrder: 'asc', releaseState: 'upcoming' }), EMPTY_LIST_RESPONSE),
    safeTmdb('upcoming_series', partialFailures, () => tmdb.discoverTv({ page: 1, sortBy: 'first_air_date', sortOrder: 'asc', releaseState: 'upcoming' }), EMPTY_LIST_RESPONSE),
    safeTmdb('movie_genres', partialFailures, () => tmdb.movieGenres(), []),
    safeTmdb('series_genres', partialFailures, () => tmdb.tvGenres(), []),
    safeTmdb('anime_movies', partialFailures, () => tmdb.discoverMovie({ page: 1, sortBy: 'popularity', sortOrder: 'desc', anime: true }), EMPTY_LIST_RESPONSE),
    safeTmdb('anime_series', partialFailures, () => tmdb.discoverTv({ page: 1, sortBy: 'popularity', sortOrder: 'desc', anime: true }), EMPTY_LIST_RESPONSE),
    safeTmdb('movie_providers', partialFailures, () => tmdb.movieWatchProviders('US'), []),
    safeTmdb('tv_providers', partialFailures, () => tmdb.tvWatchProviders('US'), []),
  ]);

  const anime = dedupeDiscoverItems([
    ...normalizeItems(animeMovies.results, 'movie'),
    ...normalizeItems(animeShows.results, 'tv'),
  ]).filter((item) => {
    if (item.mediaType === 'movie') {
      const raw = animeMovies.results.find((r) => r.id === item.tmdbId);
      return raw ? isJapaneseAnime(raw, 'movie') : item.isAnime;
    }

    const raw = animeShows.results.find((r) => r.id === item.tmdbId);
    return raw ? isJapaneseAnime(raw, 'tv') : item.isAnime;
  });

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
      items: normalizeItems(trending.results, 'all').slice(0, 20),
    },
    {
      key: 'popular_movies',
      title: 'Popular Movies',
      type: 'media',
      mediaType: 'movie',
      items: normalizeItems(popularMovies.results, 'movie').slice(0, 20),
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
      items: normalizeItems(upcomingMovies.results, 'movie').slice(0, 20),
    },
    {
      key: 'providers',
      title: 'Studios & Platforms',
      type: 'provider',
      mediaType: 'all',
      items: providers,
    },
    {
      key: 'popular_series',
      title: 'Popular Series',
      type: 'media',
      mediaType: 'tv',
      items: normalizeItems(popularSeries.results, 'tv').slice(0, 20),
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
      items: normalizeItems(upcomingSeries.results, 'tv').slice(0, 20),
    },
    {
      key: 'popular_anime',
      title: 'Popular Anime',
      type: 'media',
      mediaType: 'all',
      items: anime.slice(0, 20),
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

  if (params.contentType === 'anime') {
    const [movie, tv] = await Promise.all([
      tmdb.searchMovie(query, params.page),
      tmdb.searchTv(query, params.page),
    ]);

    return {
      page: params.page,
      total_pages: Math.max(movie.total_pages, tv.total_pages),
      total_results: movie.total_results + tv.total_results,
      results: [
        ...movie.results.map((item) => ({ ...item, media_type: 'movie' as const })),
        ...tv.results.map((item) => ({ ...item, media_type: 'tv' as const })),
      ],
    };
  }

  return tmdb.searchMulti(query, params.page);
}

async function discoverItems(params: {
  page: number;
  contentType: DiscoverContentType;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  filters: DiscoverFilters;
}) {
  const tmdb = await getTMDBClient();
  const hasFilters = hasDiscoverFilters(params.filters);
  const effectiveSortBy = params.sortBy === 'trending' && hasFilters ? 'popular' : params.sortBy;

  if (effectiveSortBy === 'trending') {
    if (params.contentType === 'movie') {
      return { data: await tmdb.trending('movie', params.page), mediaType: 'movie' as const };
    }

    if (params.contentType === 'show') {
      return { data: await tmdb.trending('tv', params.page), mediaType: 'tv' as const };
    }

    if (params.contentType === 'anime') {
      const [movie, tv] = await Promise.all([
        tmdb.trending('movie', params.page),
        tmdb.trending('tv', params.page),
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
    releaseState: params.filters.releaseState,
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

  if (params.contentType === 'anime') {
    const [movie, tv] = await Promise.all([
      tmdb.discoverMovie({ ...preset, anime: true }),
      tmdb.discoverTv({
        ...preset,
        anime: true,
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

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const mode = (searchParams.get('mode') || 'sections') as 'sections' | 'browse' | 'search';

    if (mode === 'sections') {
      const now = Date.now();
      if (sectionsCache && now < sectionsCache.expiresAt) {
        return NextResponse.json({ mode: 'sections', sections: sectionsCache.data } satisfies DiscoverResponse);
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
      const body: DiscoverResponse = { mode: 'sections', sections: fallbackSections || [] };
      return NextResponse.json(body);
    }

    const page = parseNumber(searchParams.get('page')) || 1;
    const query = searchParams.get('q') || '';
    const section = searchParams.get('section');

    const sectionOverride = section ? SECTION_SORT_OVERRIDES[section] : undefined;
    const contentType = sectionOverride?.contentType || asContentType(searchParams.get('contentType'));
    const sortBy = sectionOverride?.sortBy || asSort(searchParams.get('sortBy'));
    const sortOrder = sectionOverride?.sortOrder || asSortOrder(searchParams.get('sortOrder'));
    const filters = parseFilters(searchParams);

    const result = mode === 'search' || query.trim()
      ? await searchItems({ q: query, page, contentType })
      : await discoverItems({ page, contentType, sortBy, sortOrder, filters }).then((res) => res.data);

    let items = normalizeItems(
      result.results,
      contentType === 'movie'
        ? 'movie'
        : contentType === 'show'
          ? 'tv'
          : 'all'
    );

    if (contentType === 'anime') {
      items = items.filter((item) => item.isAnime);
    }

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

    if (!query && sortBy === 'upcoming') {
      items = items
        .filter((item) => (item.releaseDate ? item.releaseDate >= new Date().toISOString().slice(0, 10) : false))
        .sort((a, b) => (a.releaseDate || '').localeCompare(b.releaseDate || ''));
    }

    items = dedupeDiscoverItems(items);

    const { movies, series } = await getLibraries();
    items = annotateDiscoverItems(items, movies, series);

    const body: DiscoverResponse = {
      mode: query.trim() ? 'search' : 'browse',
      page: result.page,
      totalPages: result.total_pages,
      totalResults: result.total_results,
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
