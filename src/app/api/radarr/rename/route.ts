import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const movieId = Number(new URL(request.url).searchParams.get('movieId'));
    if (!Number.isFinite(movieId) || movieId <= 0) {
      return NextResponse.json({ error: 'movieId is required' }, { status: 400 });
    }
    const client = await getRadarrClient();
    const preview = await client.getRenamePreview(movieId);
    return NextResponse.json(preview);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch rename preview';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
