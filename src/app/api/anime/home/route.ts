import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { loadTaggedLibrary } from '@/lib/service-helpers';
import { getAnimeHome } from '@/lib/anilist-client';
import { normalizeAniListItem } from '@/lib/anilist-helpers';
import { annotateAnimeItems } from '@/lib/anime-library';
import { loadLibraryLinksForAnilistIds } from '@/lib/anilist-series-mapping';
import type { AniListMediaSeason, AniListMedia } from '@/types/anilist';
import { withApiLogging } from '@/lib/api-logger';

interface SeasonWindow {
  season: AniListMediaSeason;
  year: number;
}

const HOME_PER_PAGE_MIN = 10;
const HOME_PER_PAGE_MAX = 50;
const HOME_PER_PAGE_DEFAULT = 10;

async function getLibraries() {
  const { movies, series } = await loadTaggedLibrary();
  return { movies, series };
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

    // One reverse-lookup query for every entry across all sections.
    const allIds = [
      ...result.trending,
      ...result.season,
      ...result.nextSeason,
      ...result.popular,
      ...result.top,
    ].map((media) => media.id);
    const mappingLinks = await loadLibraryLinksForAnilistIds(allIds);

    const normalizeAndAnnotate = (items: AniListMedia[]) =>
      annotateAnimeItems(items.map(normalizeAniListItem), movies, series, mappingLinks);

    const currentSeason: SeasonWindow = current;
    const nextSeasonInfo: SeasonWindow = next;

    const [trending, season, nextSeason, popular, top] = await Promise.all([
      normalizeAndAnnotate(result.trending),
      normalizeAndAnnotate(result.season),
      normalizeAndAnnotate(result.nextSeason),
      normalizeAndAnnotate(result.popular),
      normalizeAndAnnotate(result.top),
    ]);

    return NextResponse.json({
      currentSeason,
      nextSeasonInfo,
      trending,
      season,
      nextSeason,
      popular,
      top,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load anime home data';
    console.error('[Anime Home API]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/anime/home');
