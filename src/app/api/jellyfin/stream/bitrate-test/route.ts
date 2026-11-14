import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

const MAX_BYTES = 1_000_000;
const MIN_BYTES = 64_000;
const DEFAULT_BYTES = 500_000;

/** Random, so no compression on the way can make the link look faster than it is. */
let payload: Buffer | null = null;

/**
 * A timed download for the player's Automatic quality: what jellyfin-web asks
 * Jellyfin's `/Playback/BitrateTest` for (bitrateTest.ts), served here because
 * every byte of media reaches the viewer through Helprr, so this link is the
 * one that limits it. Bounded in size and behind the same capability as
 * playback.
 */
async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.view');
  if (!auth.ok) return auth.response;

  const requested = Number(request.nextUrl.searchParams.get('size'));
  const size = Number.isFinite(requested) && requested > 0
    ? Math.min(MAX_BYTES, Math.max(MIN_BYTES, Math.floor(requested)))
    : DEFAULT_BYTES;
  payload ??= randomBytes(MAX_BYTES);

  return new NextResponse(new Uint8Array(payload.subarray(0, size)), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(size),
      'Cache-Control': 'no-store',
    },
  });
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/stream/bitrate-test', { logBodies: false });
