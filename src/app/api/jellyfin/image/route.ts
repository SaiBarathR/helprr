import { NextRequest, NextResponse } from 'next/server';
import type { User } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getCurrentUser, requireAuth, requireCapability } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { fetchImageWithServerCache } from '@/lib/cache/image-cache';
import { getJellyfinUserContext } from '@/lib/service-helpers';
import { getRedisClient } from '@/lib/redis';
import { withApiLogging } from '@/lib/api-logger';

const ITEM_ID_RE = /^[a-f0-9-]+$/i;
const ALLOWED_IMAGE_TYPES = new Set(['Primary', 'Backdrop', 'Banner', 'Thumb', 'Logo']);
const ITEM_ACCESS_TTL_SECONDS = 15 * 60;

/**
 * Images are fetched with the connection's admin API key, which can read
 * artwork for any item server-wide. Members are therefore checked against
 * their own Jellyfin account first (same per-user scoping as every other
 * Jellyfin route); the verdict is cached in Redis so a poster grid doesn't
 * pay an upstream round-trip per image. Fails closed: no linked account or
 * an upstream error denies access.
 */
async function canUserAccessItem(user: User, itemId: string): Promise<boolean> {
  let context: Awaited<ReturnType<typeof getJellyfinUserContext>>;
  try {
    context = await getJellyfinUserContext(user);
  } catch {
    return false;
  }

  const cacheKey = `jellyfin:item-access:${context.connectionFingerprint}:${context.jellyfinUserId}:${itemId.toLowerCase()}`;
  try {
    const redis = await getRedisClient();
    const cached = await redis.get(cacheKey);
    if (cached !== null) return cached === '1';
  } catch {
    // Redis unavailable — fall through to a live check.
  }

  let allowed: boolean;
  try {
    const result = await context.client.getItems({ ids: itemId, limit: 1 });
    allowed = (result.Items?.length ?? 0) > 0;
  } catch {
    return false;
  }

  try {
    const redis = await getRedisClient();
    await redis.set(cacheKey, allowed ? '1' : '0', { EX: ITEM_ACCESS_TTL_SECONDS });
  } catch {
    // Best-effort cache write.
  }

  return allowed;
}

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('jellyfin.view');
  if (capError) return capError;

  try {
    const { searchParams } = new URL(request.url);
    const itemId = searchParams.get('itemId');
    const type = searchParams.get('type') || 'Primary';
    const maxWidthRaw = searchParams.get('maxWidth') || '300';
    const qualityRaw = searchParams.get('quality') || '90';

    if (!itemId || !ITEM_ID_RE.test(itemId)) {
      return NextResponse.json({ error: 'Invalid itemId' }, { status: 400 });
    }

    if (!ALLOWED_IMAGE_TYPES.has(type)) {
      return NextResponse.json({ error: 'Invalid image type' }, { status: 400 });
    }

    const maxWidthParsed = Number.parseInt(maxWidthRaw, 10);
    const qualityParsed = Number.parseInt(qualityRaw, 10);
    const maxWidth = Number.isFinite(maxWidthParsed) ? Math.min(Math.max(maxWidthParsed, 1), 2000) : 300;
    const quality = Number.isFinite(qualityParsed) ? Math.min(Math.max(qualityParsed, 1), 100) : 90;

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    // jellyfin.sessions and jellyfin.stats deliberately expose server-wide
    // playback metadata (every user's now-playing and history), so artwork for
    // those items is no more privileged than what those routes already reveal
    // — without this bypass, session cards and analytics render with 404
    // posters. Everyone else is limited to their own Jellyfin account's scope.
    const canSeeServerWideArtwork =
      user.role === 'admin' || can(user, 'jellyfin.sessions') || can(user, 'jellyfin.stats');
    if (!canSeeServerWideArtwork && !(await canUserAccessItem(user, itemId))) {
      return new NextResponse(null, { status: 404 });
    }

    const connection = await prisma.serviceConnection.findFirst({
      where: { type: 'JELLYFIN' },
    });

    if (!connection) {
      return new NextResponse(null, { status: 404 });
    }

    const url = `${connection.url.replace(/\/+$/, '')}/Items/${encodeURIComponent(itemId)}/Images/${encodeURIComponent(type)}?maxWidth=${maxWidth}&quality=${quality}`;
    const connectionOrigin = new URL(connection.url).origin;

    const result = await fetchImageWithServerCache({
      cacheKey: `jellyfin:${itemId}:${type}:${maxWidth}:${quality}`,
      upstreamUrl: url,
      upstreamHeaders: {
        Authorization: `MediaBrowser Token="${connection.apiKey}"`,
        'X-Emby-Token': connection.apiKey,
      },
      // Only follow redirects that stay on the configured Jellyfin server.
      isRedirectTargetAllowed: (target) => target.origin === connectionOrigin,
    });

    if (!result.body) {
      return new NextResponse(null, {
        status: result.status,
        headers: {
          'X-Helprr-Cache': result.cacheStatus,
        },
      });
    }

    return new NextResponse(new Uint8Array(result.body), {
      headers: {
        'Content-Type': result.contentType || 'image/jpeg',
        'Cache-Control': 'private, max-age=86400, stale-while-revalidate=604800, stale-if-error=2592000',
        'X-Helprr-Cache': result.cacheStatus,
      },
    });
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/image');
