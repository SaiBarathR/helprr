import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getRadarrClient, getSonarrClient } from '@/lib/service-helpers';
import { getAnimeHome } from '@/lib/anilist-client';
import { normalizeAniListItem, isMovieFormat } from '@/lib/anilist-helpers';
import { buildLibraryLookups, matchMovieInLibrary, matchSeriesInLibrary } from '@/lib/discover';
import type { RadarrMovie, SonarrSeries, DiscoverLibraryStatus } from '@/types';
import type { AniListMediaSeason, AniListListItem, AniListMedia } from '@/types/anilist';
import { withApiLogging } from '@/lib/api-logger';

interface SeasonWindow {
  season: AniListMediaSeason;
  year: number;
}

const HOME_PER_PAGE_MIN = 10;
const HOME_PER_PAGE_MAX = 50;
const HOME_PER_PAGE_DEFAULT = 10;

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

function getCurrentSeasonClient(): { season: AniListMediaSeason; year: number } {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  if (month >= 4 && month <= 6) return { season: 'SPRING', year };
  if (month >= 7 && month <= 9) return { season: 'SUMMER', year };
  if (month >= 10 && month <= 12) return { season: 'FALL', year };
  return { season: 'WINTER', year };
}

function getNextSeasonClient(currentSeason: AniListMediaSeason, currentYear: number): { season: AniListMediaSeason; year: number } {
  if (currentSeason === 'WINTER') return { season: 'SPRING', year: currentYear };
  if (currentSeason === 'SPRING') return { season: 'SUMMER', year: currentYear };
  if (currentSeason === 'SUMMER') return { season: 'FALL', year: currentYear };
  return { season: 'WINTER', year: currentYear + 1 };
}

function getHomePerPage(request: NextRequest): number {
  const raw = Number(new URL(request.url).searchParams.get('perPage'));
  if (!Number.isFinite(raw)) return HOME_PER_PAGE_DEFAULT;
  return Math.min(HOME_PER_PAGE_MAX, Math.max(HOME_PER_PAGE_MIN, Math.round(raw)));
}

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const current = getCurrentSeasonClient();
    const next = getNextSeasonClient(current.season, current.year);
    const perPage = getHomePerPage(request);

    const [result, { movies, series }] = await Promise.all([
      getAnimeHome(current.season, current.year, next.season, next.year, perPage),
      getLibraries(),
    ]);

    const normalizeAndAnnotate = (items: AniListMedia[]) =>
      annotateAnimeItems(items.map(normalizeAniListItem), movies, series);

    const currentSeason: SeasonWindow = current;
    const nextSeasonInfo: SeasonWindow = next;

    return NextResponse.json({
      currentSeason,
      nextSeasonInfo,
      trending: normalizeAndAnnotate(result.trending),
      season: normalizeAndAnnotate(result.season),
      nextSeason: normalizeAndAnnotate(result.nextSeason),
      popular: normalizeAndAnnotate(result.popular),
      top: normalizeAndAnnotate(result.top),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load anime home data';
    console.error('[Anime Home API]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/anime/home');
