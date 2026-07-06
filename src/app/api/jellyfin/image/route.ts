import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth, requireCapability } from '@/lib/auth';
import { fetchImageWithServerCache } from '@/lib/cache/image-cache';
import { withApiLogging } from '@/lib/api-logger';

const ITEM_ID_RE = /^[a-f0-9-]+$/i;
const ALLOWED_IMAGE_TYPES = new Set(['Primary', 'Backdrop', 'Banner', 'Thumb', 'Logo']);

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
