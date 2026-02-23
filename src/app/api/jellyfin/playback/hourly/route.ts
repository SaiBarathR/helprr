import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { getDefaultEndDate, sanitizeDays } from '@/lib/jellyfin-playback-query';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const days = sanitizeDays(searchParams.get('days'), 7);
    const endDate = searchParams.get('endDate') || getDefaultEndDate();

    const client = await getJellyfinClient();

    let filter = searchParams.get('filter');
    if (!filter) {
      const types = await client.getTypeFilterList();
      filter = !types || types.length === 0 ? 'Movie,Episode,Audio' : types.join(',');
    }

    const data = await client.getHourlyReport(days, endDate, filter);
    return NextResponse.json({ data: data ?? {}, pluginAvailable: data !== null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch hourly report';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
