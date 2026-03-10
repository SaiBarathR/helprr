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
import type { AniListMediaFormat, AniListMediaSeason, AniListMediaStatus, AniListListItem } from '@/types/anilist';

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

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode') || 'browse';

    const page = Number(searchParams.get('page')) || 1;
    const perPage = Math.min(Number(searchParams.get('perPage')) || 20, 50);

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
    const sort = searchParams.get('sort') || 'trending';
    const genresParam = searchParams.get('genres');
    const genres = genresParam ? genresParam.split(',').map((g) => g.trim()).filter(Boolean) : undefined;
    const yearParam = searchParams.get('year');
    const year = yearParam ? Number(yearParam) : undefined;
    const yearMinParam = searchParams.get('yearMin');
    const yearMin = yearMinParam ? Number(yearMinParam) : undefined;
    const yearMaxParam = searchParams.get('yearMax');
    const yearMax = yearMaxParam ? Number(yearMaxParam) : undefined;
    const seasonParam = searchParams.get('season') as AniListMediaSeason | null;
    const formatParam = searchParams.get('format');
    const formats = formatParam
      ? formatParam.split(',').map((f) => f.trim()).filter(Boolean) as AniListMediaFormat[]
      : undefined;
    const status = searchParams.get('status') as AniListMediaStatus | null;

    const result = await browseAnime({
      page,
      perPage,
      sort,
      genres,
      year: year && Number.isFinite(year) ? year : undefined,
      yearLesser: yearMax && Number.isFinite(yearMax) ? yearMax : undefined,
      yearGreater: yearMin && Number.isFinite(yearMin) ? yearMin : undefined,
      season: seasonParam || undefined,
      format: formats?.length ? formats : undefined,
      status: status || undefined,
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
