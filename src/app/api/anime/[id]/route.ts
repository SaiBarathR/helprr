import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getRadarrClient, getSonarrClient } from '@/lib/service-helpers';
import { getAnimeDetail } from '@/lib/anilist-client';
import { normalizeAniListDetail, isMovieFormat } from '@/lib/anilist-helpers';
import {
  buildLibraryLookups,
  matchMovieInLibrary,
  matchSeriesInLibrary,
} from '@/lib/discover';
import type { RadarrMovie, SonarrSeries } from '@/types';

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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid anime ID' }, { status: 400 });
    }

    const [detail, libraryResult] = await Promise.all([
      getAnimeDetail(id),
      getLibraries(),
    ]);

    const normalized = normalizeAniListDetail(detail);
    const lookups = buildLibraryLookups(libraryResult.movies, libraryResult.series);

    const library = isMovieFormat(normalized.format)
      ? matchMovieInLibrary(lookups, {
          tmdbId: normalized.tmdbId ?? undefined,
          title: normalized.title,
          year: normalized.year,
        })
      : matchSeriesInLibrary(lookups, {
          tvdbId: normalized.tvdbId,
          title: normalized.title,
          year: normalized.year,
        });

    return NextResponse.json({
      ...normalized,
      library,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load anime detail';
    console.error('[Anime Detail API]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
