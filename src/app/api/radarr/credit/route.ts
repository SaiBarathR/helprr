import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const rawMovieId = new URL(request.url).searchParams.get('movieId');
  if (!rawMovieId || rawMovieId.trim() === '') {
    return NextResponse.json({ error: 'movieId is required' }, { status: 400 });
  }

  const movieId = Number(rawMovieId);
  if (!Number.isInteger(movieId) || movieId <= 0) {
    return NextResponse.json({ error: 'movieId is required' }, { status: 400 });
  }

  try {
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getRadarrClient(instanceId);
    const credits = await client.getCredits(movieId);
    return NextResponse.json(credits);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch credits');
  }
}

export const GET = withApiLogging(getHandler, 'api/radarr/credit');
