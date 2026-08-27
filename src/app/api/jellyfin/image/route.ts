import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUserCapability } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { fetchImageWithServerCache } from '@/lib/cache/image-cache';
import { getConnectionHeaders } from '@/lib/service-connection-secrets';
import { canUserAccessItem } from '@/lib/jellyfin-playback/item-access';
import { withApiLogging } from '@/lib/api-logger';

const ITEM_ID_RE = /^[a-f0-9-]+$/i;
const ALLOWED_IMAGE_TYPES = new Set(['Primary', 'Backdrop', 'Banner', 'Thumb', 'Logo']);


async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.view');
  if (!auth.ok) return auth.response;

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

    const { user } = auth;
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

    const connectionBase = new URL(connection.url);
    connectionBase.hash = '';
    const connectionBasePath = connectionBase.pathname.replace(/\/+$/, '');
    const url = new URL(
      `${connectionBasePath}/Items/${encodeURIComponent(itemId)}/Images/${encodeURIComponent(type)}?maxWidth=${maxWidth}&quality=${quality}`,
      `${connectionBase.origin}/`,
    );
    const connectionOrigin = connectionBase.origin;

    const result = await fetchImageWithServerCache({
      cacheKey: `jellyfin:${itemId}:${type}:${maxWidth}:${quality}`,
      upstreamUrl: url.toString(),
      upstreamHeaders: {
        // Custom headers first so Helprr's own token headers win; no-op unless
        // HELPRR_CUSTOM_HEADERS is enabled.
        ...getConnectionHeaders(connection),
        Authorization: `MediaBrowser Token="${connection.apiKey}"`,
        'X-Emby-Token': connection.apiKey,
      },
      requesterId: user.id,
      signal: request.signal,
      // Only follow redirects that stay on the configured Jellyfin server.
      isRedirectTargetAllowed: (target) => target.origin === connectionOrigin,
    });

    if (!result.body) {
      return new NextResponse(null, {
        status: result.status,
        headers: {
          'X-Helprr-Cache': result.cacheStatus,
          ...(result.retryAfterSeconds
            ? { 'Retry-After': String(result.retryAfterSeconds) }
            : {}),
          ...(result.timings
            ? { 'Server-Timing': `helprr-queue;dur=${result.timings.queueMs}, helprr-upstream;dur=${result.timings.upstreamMs}` }
            : {}),
        },
      });
    }

    return new NextResponse(new Uint8Array(result.body), {
      headers: {
        'Content-Type': result.contentType!,
        // Revalidate the jellyfin.view and per-item authorization boundary on
        // every use while still allowing the browser to retain validated bytes.
        'Cache-Control': result.cacheStatus === 'BYPASS'
          ? 'private, no-store'
          : 'private, no-cache',
        Vary: 'Cookie',
        'X-Helprr-Cache': result.cacheStatus,
        ...(result.timings
          ? { 'Server-Timing': `helprr-queue;dur=${result.timings.queueMs}, helprr-upstream;dur=${result.timings.upstreamMs}` }
          : {}),
      },
    });
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/image');
