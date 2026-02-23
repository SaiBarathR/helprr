import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { getDefaultEndDate, sanitizeDays } from '@/lib/jellyfin-playback-query';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  try {
    const { type } = await params;
    const { searchParams } = new URL(request.url);
    const days = sanitizeDays(searchParams.get('days'), 30);
    const endDate = searchParams.get('endDate') || getDefaultEndDate();

    const validTypes = ['UserId', 'ItemType', 'PlaybackMethod', 'ClientName', 'DeviceName'];
    if (!validTypes.includes(type)) {
      return NextResponse.json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` }, { status: 400 });
    }

    const client = await getJellyfinClient();
    const entries = await client.getBreakdownReport(type, days, endDate);
    return NextResponse.json({ entries: entries ?? [], pluginAvailable: entries !== null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch breakdown report';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
