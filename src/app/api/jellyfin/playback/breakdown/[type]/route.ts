import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  try {
    const { type } = await params;
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30', 10);
    const d = new Date();
    const endDate = searchParams.get('endDate') ||
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

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
