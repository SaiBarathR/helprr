import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const movieId = Number(new URL(request.url).searchParams.get('movieId'));
  if (!Number.isFinite(movieId)) {
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
