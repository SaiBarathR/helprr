import { NextRequest, NextResponse } from 'next/server';
import { JellyfinNotLinkedError, getJellyfinUserContext } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { invalidateWatchStatus, watchStatusMapSeed } from '@/lib/cache/jellyfin-watch-status-cache';

const ITEM_ID_RE = /^[a-f0-9-]+$/i;

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.watchedState');
  if (!auth.ok) return auth.response;

  let body: { itemId?: unknown; favorite?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const itemId = typeof body.itemId === 'string' ? body.itemId : '';
  if (!ITEM_ID_RE.test(itemId) || typeof body.favorite !== 'boolean') {
    return NextResponse.json({ error: 'itemId and favorite are required' }, { status: 400 });
  }

  try {
    const { client, connectionFingerprint, jellyfinUserId } = await getJellyfinUserContext(auth.user);
    const userData = await client.setFavorite(itemId, body.favorite);
    await invalidateWatchStatus(watchStatusMapSeed(connectionFingerprint, jellyfinUserId));
    return NextResponse.json({ userData });
  } catch (error) {
    if (error instanceof JellyfinNotLinkedError) {
      return NextResponse.json({ error: 'Jellyfin account not linked' }, { status: 400 });
    }
    return upstreamErrorResponse(error, 'Failed to update favorite');
  }
}

export const POST = withApiLogging(postHandler, 'api/jellyfin/catalog/favorite');
