import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { getDefaultEndDate, sanitizeDays } from '@/lib/jellyfin-playback-query';
import { requireAuth } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const days = sanitizeDays(searchParams.get('days'), 30);
    const endDate = searchParams.get('endDate') || getDefaultEndDate();

    const client = await getJellyfinClient();
    const movies = await client.getMoviesReport(days, endDate);
    return NextResponse.json({ movies: movies ?? [], pluginAvailable: movies !== null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch movies report';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
