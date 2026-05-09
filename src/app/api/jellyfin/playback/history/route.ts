import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler(request: NextRequest): Promise<NextResponse> {
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
      resolvedFilter = types && types?.length > 0 ? types.join(',') : 'Movie,Episode,Audio';
    }

    const items = await client.getPlaybackHistory(userId, date, resolvedFilter);
    return NextResponse.json({ items: items ?? [], pluginAvailable: items !== null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch playback history';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/playback/history');
