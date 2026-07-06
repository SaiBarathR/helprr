import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const movieIdRaw = searchParams.get('movieId');
    const movieId = movieIdRaw ? Number(movieIdRaw) : NaN;

    if (!Number.isFinite(movieId) || movieId <= 0) {
      return NextResponse.json({ error: 'movieId is required' }, { status: 400 });
    }

    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getRadarrClient(instanceId);
    const history = await client.getMovieHistory(movieId);
    return NextResponse.json(history);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch movie history');
  }
}

export const GET = withApiLogging(getHandler, 'api/radarr/history/movie');
