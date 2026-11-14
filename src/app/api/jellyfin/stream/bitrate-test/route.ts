import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

const MAX_BYTES = 1_000_000;
const MIN_BYTES = 64_000;
const DEFAULT_BYTES = 500_000;

/** Random, so no compression on the way can make the link look faster than it is. */
let payload: Uint8Array<ArrayBuffer> | null = null;

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
  // Nothing plays without a linked account (the start gates on it next), so
  // no 500 kB ahead of the Connect form. Presence only: a revoked token is
  // caught by the start itself.
  if (!auth.user.jellyfinToken) {
    return NextResponse.json({ error: 'jellyfin_connect_required' }, { status: 409 });
  }

  const requested = Number(request.nextUrl.searchParams.get('size'));
  const size = Number.isFinite(requested) && requested > 0
    ? Math.min(MAX_BYTES, Math.max(MIN_BYTES, Math.floor(requested)))
    : DEFAULT_BYTES;
  payload ??= randomBytes(MAX_BYTES);

  return new NextResponse(payload.subarray(0, size), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(size),
      'Cache-Control': 'no-store',
    },
  });
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/stream/bitrate-test', { logBodies: false });
