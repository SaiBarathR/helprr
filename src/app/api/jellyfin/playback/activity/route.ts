import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { getDefaultEndDate, sanitizeDays } from '@/lib/jellyfin-playback-query';
import { requireAuth } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const days = sanitizeDays(searchParams.get('days'), 7);
    const endDate = searchParams.get('endDate') || getDefaultEndDate();
    const dataType = searchParams.get('dataType') || 'count';

    const client = await getJellyfinClient();

    // filter is required — resolve from type_filter_list if not provided
    let filter = searchParams.get('filter');
    if (!filter) {
      const types = await client.getTypeFilterList();
      filter = types ? types.join(',') : 'Movie,Episode,Audio';
    }

    const data = await client.getPlayActivity(days, endDate, filter, dataType);
    return NextResponse.json({ data: data ?? [], pluginAvailable: data !== null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch play activity';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
