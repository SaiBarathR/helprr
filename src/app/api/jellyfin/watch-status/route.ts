import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { getJellyfinUserContext, isJellyfinUnavailable } from '@/lib/service-helpers';
import { fetchUserWatchStatusMap } from '@/lib/jellyfin-watch-status-map';
import {
  invalidateWatchStatus,
  seriesEpisodesSeed,
  watchStatusMapSeed,
} from '@/lib/cache/jellyfin-watch-status-cache';
import type { WatchStatusMapResponse } from '@/types/watch-status';

const EMPTY: WatchStatusMapResponse = { linked: false, items: [], keys: {} };

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.view');
  if (!auth.ok) return auth.response;

  try {
    const payload = await fetchUserWatchStatusMap(auth.user);
    if (!payload) return NextResponse.json(EMPTY);
    return NextResponse.json({ linked: true, ...payload } satisfies WatchStatusMapResponse);
  } catch (error) {
    if (isJellyfinUnavailable(error)) return NextResponse.json(EMPTY);
    // Never 500 a navigation: on a hard failure with no cache, just render no
    // indicators rather than breaking the page the overlay sits on.
    console.error('Jellyfin watch-status map failed:', error);
    return NextResponse.json(EMPTY);
  }
}

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.watchedState');
  if (!auth.ok) return auth.response;

  let body: { jellyfinItemId?: unknown; played?: unknown; seriesId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { jellyfinItemId, played, seriesId } = body;
  if (typeof jellyfinItemId !== 'string' || !jellyfinItemId || typeof played !== 'boolean') {
    return NextResponse.json({ error: 'jellyfinItemId and played are required' }, { status: 400 });
  }

  try {
    const { client, connectionFingerprint, jellyfinUserId } = await getJellyfinUserContext(auth.user);
    if (played) await client.markPlayed(jellyfinItemId);
    else await client.markUnplayed(jellyfinItemId);

    // Always invalidate the library map (a series/episode toggle flips the
    // aggregate). For a series/episode write, also drop that series' episode map
    // — marking a series cascades to its episodes server-side.
    await invalidateWatchStatus(watchStatusMapSeed(connectionFingerprint, jellyfinUserId));
    if (typeof seriesId === 'string' && seriesId) {
      await invalidateWatchStatus(seriesEpisodesSeed(connectionFingerprint, jellyfinUserId, seriesId));
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isJellyfinUnavailable(error)) {
      return NextResponse.json({ error: 'Jellyfin account not linked' }, { status: 409 });
    }
    console.error('Jellyfin watch-status write failed:', error);
    return NextResponse.json({ error: 'Failed to update watch status' }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/watch-status');
export const POST = withApiLogging(postHandler, 'api/jellyfin/watch-status');
