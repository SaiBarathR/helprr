import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getRadarrClient, getSonarrClient } from '@/lib/service-helpers';
import {
  searchAnime,
  browseAnime,
} from '@/lib/anilist-client';
import {
  normalizeAniListItem,
  isMovieFormat,
} from '@/lib/anilist-helpers';
import {
  buildLibraryLookups,
  matchMovieInLibrary,
  matchSeriesInLibrary,
} from '@/lib/discover';
import type { RadarrMovie, SonarrSeries, DiscoverLibraryStatus } from '@/types';
import type {
  AniListMediaFormat,
  AniListMediaSeason,
  AniListMediaStatus,
  AniListListItem,
  AnimeBrowseSort,
} from '@/types/anilist';

const VALID_SORTS = new Set<AnimeBrowseSort>([
  'seasonal',
  'trending',
  'popularity',
  'score',
  'newest',
  'title',
  'favourites',
  'date_added',
  'release_date',
]);
const VALID_SEASONS = new Set<AniListMediaSeason>(['WINTER', 'SPRING', 'SUMMER', 'FALL']);
const VALID_FORMATS = new Set<AniListMediaFormat>([
  'TV',
  'TV_SHORT',
  'MOVIE',
  'SPECIAL',
  'OVA',
  'ONA',
  'MUSIC',
  'MANGA',
  'NOVEL',
  'ONE_SHOT',
]);
const VALID_STATUSES = new Set<AniListMediaStatus>([
  'FINISHED',
  'RELEASING',
  'NOT_YET_RELEASED',
  'CANCELLED',
  'HIATUS',
]);

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

function annotateAnimeItems(
  items: AniListListItem[],
  movies: RadarrMovie[],
  series: SonarrSeries[]
): (AniListListItem & { library?: DiscoverLibraryStatus })[] {
  if (!movies.length && !series.length) return items;

  const lookups = buildLibraryLookups(movies, series);

  return items.map((item) => {
    if (isMovieFormat(item.format)) {
      return {
        ...item,
        library: matchMovieInLibrary(lookups, {
          title: item.title,
          year: item.year,
        }),
      };
    }

    return {
      ...item,
      library: matchSeriesInLibrary(lookups, {
        title: item.title,
        year: item.year,
      }),
    };
  });
}

function parsePositiveInteger(value: string | null, fallback: number) {
  const parsed = value ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function parseOptionalYear(value: string | null) {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode') || 'browse';

    const page = parsePositiveInteger(searchParams.get('page'), 1);
    const perPage = Math.min(parsePositiveInteger(searchParams.get('perPage'), 20), 50);

    if (mode === 'search') {
      const q = searchParams.get('q')?.trim();
      if (!q) {
        return NextResponse.json({ mode: 'search', items: [], pageInfo: null });
      }

      const result = await searchAnime(q, page, perPage);
      const { movies, series } = await getLibraries();
      const items = annotateAnimeItems(result.media.map(normalizeAniListItem), movies, series);

      return NextResponse.json({
        mode: 'search',
        items,
        pageInfo: result.pageInfo,
      });
    }

    // Browse mode
    const sortParam = searchParams.get('sort');
    const seasonParam = searchParams.get('season');
    const formatParam = searchParams.get('format');
    const statusParam = searchParams.get('status');
    const invalidParams: string[] = [];

    const sort = sortParam
      ? (VALID_SORTS.has(sortParam as AnimeBrowseSort) ? sortParam as AnimeBrowseSort : (invalidParams.push('sort'), null))
      : 'seasonal';
    const season = seasonParam
      ? (VALID_SEASONS.has(seasonParam as AniListMediaSeason) ? seasonParam as AniListMediaSeason : (invalidParams.push('season'), null))
      : undefined;
    const formats = formatParam
      ? formatParam.split(',').map((f) => f.trim()).filter(Boolean)
      : [];
    const invalidFormats = formats.filter((format) => !VALID_FORMATS.has(format as AniListMediaFormat));
    const normalizedFormats = formatParam && !invalidFormats.length && formats.length
      ? formats as AniListMediaFormat[]
      : undefined;
    if (formatParam && (!formats.length || invalidFormats.length)) invalidParams.push('format');
    const status = statusParam
      ? (VALID_STATUSES.has(statusParam as AniListMediaStatus) ? statusParam as AniListMediaStatus : (invalidParams.push('status'), null))
      : undefined;

    if (invalidParams.length) {
      return NextResponse.json(
        {
          error: 'Invalid anime browse parameters',
          invalidParams,
        },
        { status: 400 }
      );
    }

    const genresParam = searchParams.get('genres');
    const genres = genresParam ? genresParam.split(',').map((g) => g.trim()).filter(Boolean) : undefined;
    const yearParam = searchParams.get('year');
    const year = parseOptionalYear(yearParam);
    const yearMinParam = searchParams.get('yearMin');
    const yearMin = parseOptionalYear(yearMinParam);
    const yearMaxParam = searchParams.get('yearMax');
    const yearMax = parseOptionalYear(yearMaxParam);

    const result = await browseAnime({
      page,
      perPage,
      sort: sort ?? 'seasonal',
      genres,
      year: year && Number.isFinite(year) ? year : undefined,
      yearLesser: yearMax && Number.isFinite(yearMax) ? yearMax : undefined,
      yearGreater: yearMin && Number.isFinite(yearMin) ? yearMin : undefined,
      season: season ?? undefined,
      format: normalizedFormats,
      status: status ?? undefined,
    });

    const { movies, series } = await getLibraries();
    const items = annotateAnimeItems(result.media.map(normalizeAniListItem), movies, series);

    return NextResponse.json({
      mode: 'browse',
      items,
      pageInfo: result.pageInfo,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load anime data';
    console.error('[Anime API]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
