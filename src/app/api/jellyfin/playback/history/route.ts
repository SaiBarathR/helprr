import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { parsePlaybackUserId } from '@/lib/jellyfin-playback-query';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.view');
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const requestedUserId = searchParams.get('userId');
    const date = searchParams.get('date');
    const filter = searchParams.get('filter');

    // Non-admins can only read their own playback history (ignore ?userId=);
    // admins may pass any user's id.
    let userId = auth.user.jellyfinUserId;
    if (auth.user.role === 'admin') {
      try {
        userId = parsePlaybackUserId(requestedUserId);
      } catch {
        return NextResponse.json({ error: 'userId must be a valid Jellyfin user ID' }, { status: 400 });
      }
    }
    if (!userId) {
      return auth.user.role === 'admin'
        ? NextResponse.json({ error: 'userId and date are required' }, { status: 400 })
        : NextResponse.json({ items: [], linked: false });
    }
    if (!date) {
      return NextResponse.json({ error: 'date is required' }, { status: 400 });
    }
    // Like the user id, the date becomes a segment of the upstream path, which
    // is signed with the server's own key.
    if (!DATE_RE.test(date)) {
      return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
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
    return upstreamErrorResponse(error, 'Failed to fetch playback history');
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/playback/history');
