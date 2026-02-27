import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const movieIdRaw = searchParams.get('movieId');
    const movieId = movieIdRaw ? Number(movieIdRaw) : NaN;

    if (!Number.isFinite(movieId) || movieId <= 0) {
      return NextResponse.json({ error: 'movieId is required' }, { status: 400 });
    }

    const client = await getRadarrClient();
    const history = await client.getMovieHistory(movieId);
    return NextResponse.json(history);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch movie history';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
