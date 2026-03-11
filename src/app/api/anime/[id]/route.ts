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

type ServiceAvailability = 'ok' | 'unavailable';

async function getLibraries() {
  const [moviesResult, seriesResult] = await Promise.allSettled([
    (async () => {
      const client = await getRadarrClient();
      return client.getMovies();
    })(),
    (async () => {
      const client = await getSonarrClient();
      return client.getSeries();
    })(),
  ]);

  return {
    movies: moviesResult.status === 'fulfilled' ? moviesResult.value : null,
    series: seriesResult.status === 'fulfilled' ? seriesResult.value : null,
    availability: {
      radarr: moviesResult.status === 'fulfilled' ? 'ok' as ServiceAvailability : 'unavailable' as ServiceAvailability,
      sonarr: seriesResult.status === 'fulfilled' ? 'ok' as ServiceAvailability : 'unavailable' as ServiceAvailability,
    },
  };
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
    const isMovie = isMovieFormat(normalized.format);
    const lookups = buildLibraryLookups(libraryResult.movies ?? [], libraryResult.series ?? []);

    const library = isMovie
      ? (
        libraryResult.availability.radarr === 'ok'
          ? matchMovieInLibrary(lookups, {
              tmdbId: normalized.tmdbId ?? undefined,
              title: normalized.title,
              year: normalized.year,
            })
          : null
      )
      : (
        libraryResult.availability.sonarr === 'ok'
          ? matchSeriesInLibrary(lookups, {
              tvdbId: normalized.tvdbId,
              title: normalized.title,
              year: normalized.year,
            })
          : null
      );

    return NextResponse.json({
      ...normalized,
      libraryAvailability: libraryResult.availability,
      library,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load anime detail';
    console.error('[Anime Detail API]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
