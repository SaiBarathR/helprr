import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient, getTMDBClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { tmdbImageUrl } from '@/lib/discover';
import { crewRolePriority } from '@/lib/crew-priority';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

const EMPTY = { cast: [], crew: [] };

async function getHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id } = await params;
    const seriesId = Number(id);
    if (!Number.isFinite(seriesId) || seriesId <= 0) {
      return NextResponse.json({ error: 'Invalid series ID' }, { status: 400 });
    }

    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const sonarr = await getSonarrClient(instanceId);
    const series = await sonarr.getSeriesById(seriesId);
    const tmdbId = series?.tmdbId;
    if (!tmdbId) {
      return NextResponse.json(EMPTY);
    }

    let tmdb;
    try {
      tmdb = await getTMDBClient();
    } catch {
      return NextResponse.json(EMPTY);
    }

    const credits = await tmdb.tvAggregateCredits(tmdbId);

    const cast = credits.cast
      .sort((a, b) => a.order - b.order)
      .map((m) => ({
        id: m.id,
        name: m.name,
        profilePath: tmdbImageUrl(m.profile_path, 'w300'),
        character: m.roles?.[0]?.character || '',
        episodeCount: m.total_episode_count,
      }));

    const crew = credits.crew
      .sort((a, b) => {
        const aJob = a.jobs?.[0]?.job || '';
        const bJob = b.jobs?.[0]?.job || '';
        return crewRolePriority(aJob) - crewRolePriority(bJob);
      })
      .map((m) => ({
        id: m.id,
        name: m.name,
        profilePath: tmdbImageUrl(m.profile_path, 'w300'),
        job: m.jobs?.[0]?.job || '',
      }));

    return NextResponse.json({ cast, crew });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch credits');
  }
}

export const GET = withApiLogging(getHandler, 'api/sonarr/[id]/credits');
