import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { getDefaultEndDate, sanitizeDays } from '@/lib/jellyfin-playback-query';
import { requireAuth } from '@/lib/auth';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const days = sanitizeDays(searchParams.get('days'), 30);
    const endDate = searchParams.get('endDate') || getDefaultEndDate();

    const client = await getJellyfinClient();
    const shows = await client.getTvShowsReport(days, endDate);
    return NextResponse.json({ shows: shows ?? [], pluginAvailable: shows !== null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch TV shows report';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
