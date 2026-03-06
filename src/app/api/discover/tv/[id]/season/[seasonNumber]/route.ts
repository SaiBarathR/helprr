import { NextRequest, NextResponse } from 'next/server';
import { getTMDBClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { tmdbImageUrl } from '@/lib/discover';
import { TmdbRateLimitError } from '@/lib/tmdb-client';
import type { DiscoverSeasonDetailResponse } from '@/types';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; seasonNumber: string }> }
): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id: idStr, seasonNumber: seasonStr } = await params;
    const tvId = Number(idStr);
    const seasonNumber = Number(seasonStr);

    if (!Number.isFinite(tvId) || tvId <= 0 || !Number.isFinite(seasonNumber) || seasonNumber < 0) {
      return NextResponse.json({ error: 'Invalid TV ID or season number' }, { status: 400 });
    }

    const tmdb = await getTMDBClient();
    const season = await tmdb.tvSeasonDetails(tvId, seasonNumber);

    const payload: DiscoverSeasonDetailResponse = {
      id: season.id,
      name: season.name,
      overview: season.overview,
      airDate: season.air_date,
      posterPath: tmdbImageUrl(season.poster_path, 'w300'),
      seasonNumber: season.season_number,
      episodes: (season.episodes || []).map((ep) => ({
        id: ep.id,
        name: ep.name,
        overview: ep.overview,
        airDate: ep.air_date,
        episodeNumber: ep.episode_number,
        seasonNumber: ep.season_number,
        stillPath: tmdbImageUrl(ep.still_path, 'w300'),
        voteAverage: ep.vote_average,
        runtime: ep.runtime,
      })),
    };

    return NextResponse.json(payload);
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
    const message = error instanceof Error ? error.message : 'Failed to load season';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
