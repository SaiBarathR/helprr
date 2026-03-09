import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';

export async function GET(request: NextRequest) {
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
    const client = await getRadarrClient();
    const credits = await client.getCredits(movieId);
    return NextResponse.json(credits);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch credits';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
