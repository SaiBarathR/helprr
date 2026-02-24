import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const date = searchParams.get('date');
    const filter = searchParams.get('filter');

    if (!userId || !date) {
      return NextResponse.json({ error: 'userId and date are required' }, { status: 400 });
    }

    const client = await getJellyfinClient();

    // filter is required by the plugin — without it, returns [].
    // If not provided, fetch all types automatically.
    let resolvedFilter = filter;
    if (!resolvedFilter) {
      const types = await client.getTypeFilterList();
      resolvedFilter = types ? types.join(',') : 'Movie,Episode,Audio';
    }

    const items = await client.getPlaybackHistory(userId, date, resolvedFilter);
    return NextResponse.json({ items: items ?? [], pluginAvailable: items !== null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch playback history';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
