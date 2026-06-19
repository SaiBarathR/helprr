import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { loadTaggedLibrary } from '@/lib/service-helpers';
import { getAnimeDetail, getAnimeNextAiringEpisode } from '@/lib/anilist-client';
import { normalizeAniListDetail, isMovieFormat } from '@/lib/anilist-helpers';
import { withApiLogging } from '@/lib/api-logger';
import { anilistRateLimitResponse } from '@/lib/anilist-http';
import {
  buildLibraryLookups,
  matchMovieInLibrary,
  matchSeriesInLibrary,
  seriesLibraryStatusFromMatches,
  type Tagged,
} from '@/lib/discover';
import { loadLibraryLinksForAnilistIds } from '@/lib/anilist-series-mapping';
import type { SonarrSeries } from '@/types';

type ServiceAvailability = 'ok' | 'unavailable';

async function getLibraries() {
  // Union across all instances; loadTaggedLibrary degrades gracefully per instance,
  // so availability is reported ok (matching runs against whatever was reachable).
  const { movies, series } = await loadTaggedLibrary();
  return {
    movies,
    series,
    availability: {
      radarr: 'ok' as ServiceAvailability,
      sonarr: 'ok' as ServiceAvailability,
    },
  };
}

async function getHandler(
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

    const [detail, nextAiringEpisode, libraryResult, mappingLinks] = await Promise.all([
      getAnimeDetail(id),
      getAnimeNextAiringEpisode(id),
      getLibraries(),
      loadLibraryLinksForAnilistIds([id]),
    ]);

    const normalized = {
      ...normalizeAniListDetail(detail),
      nextAiringEpisode,
    };
    const isMovie = isMovieFormat(normalized.format);
    const lookups = buildLibraryLookups(libraryResult.movies ?? [], libraryResult.series ?? []);

    // Reverse mapping (AniList entry → Sonarr series) catches season splits that
    // title matching misses; intersect with the live library to drop stale links.
    const mappedSeries = (mappingLinks.get(id) ?? [])
      .map((link) =>
        (libraryResult.series ?? []).find(
          (show) => show.instanceId === link.sonarrInstanceId && show.id === link.sonarrSeriesId
        )
      )
      .filter((show): show is Tagged<SonarrSeries> => !!show);

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
        libraryResult.availability.sonarr !== 'ok'
          ? null
          : mappedSeries.length
            ? seriesLibraryStatusFromMatches(mappedSeries)
            : matchSeriesInLibrary(lookups, {
                tvdbId: normalized.tvdbId,
                title: normalized.title,
                titleRomaji: normalized.titleRomaji,
                titleNative: normalized.titleNative,
                year: normalized.year,
              })
      );

    return NextResponse.json({
      ...normalized,
      libraryAvailability: libraryResult.availability,
      library,
    });
  } catch (error) {
    const rateLimited = anilistRateLimitResponse(error);
    if (rateLimited) return rateLimited;
    const message = error instanceof Error ? error.message : 'Failed to load anime detail';
    console.error('[Anime Detail API]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/anime/[id]');
