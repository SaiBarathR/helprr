import { isAxiosError } from 'axios';
import { NextResponse } from 'next/server';
import { ConfigurationError } from '@/lib/config-error';
import { JellyfinNotConnectedError, JellyfinNotLinkedError } from '@/lib/service-helpers';
import { invalidateJellyfinToken } from '@/lib/jellyfin-token';

/**
 * Convert a caught error into a client-safe JSON response. Upstream failures
 * (Axios network errors) carry internal detail like
 * `connect ECONNREFUSED 192.168.1.10:8989`, so the raw message is logged
 * server-side and never echoed to the client. An upstream 404 maps to a 404
 * instead of a 500 so a nonexistent id isn't reported as a server error.
 */
export function upstreamErrorResponse(error: unknown, fallback: string): NextResponse {
  console.error(`[api] ${fallback}:`, error instanceof Error ? error.message : error);

  if (isAxiosError(error) && error.response?.status === 404) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Intentional, user-facing configuration guidance — contains no upstream
  // detail and the settings UI relies on seeing it verbatim.
  if (error instanceof ConfigurationError) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ error: fallback }, { status: 500 });
}

/**
 * The one response every playback surface gives when it cannot act as the
 * member: they have no Jellyfin token, no identity link, or Jellyfin has
 * stopped accepting the token. The player watches for this exact code and
 * shows the connect gate in place of the video.
 *
 * A 401/403 from Jellyfin means the token was revoked upstream (an admin
 * deleting the device in Dashboard → Devices does it silently), so the stored
 * copy is dropped here — that revocation has no other signal.
 *
 * Returns null when the error is something else, so callers fall through to
 * their normal handling.
 */
export async function jellyfinConnectGateResponse(
  user: { id: string },
  error: unknown,
): Promise<NextResponse | null> {
  const needsConnect =
    error instanceof JellyfinNotConnectedError || error instanceof JellyfinNotLinkedError;

  const revoked =
    isAxiosError(error) && (error.response?.status === 401 || error.response?.status === 403);

  if (!needsConnect && !revoked) return null;

  if (revoked) {
    await invalidateJellyfinToken(user.id).catch((err) =>
      console.error('[api] Failed to drop a revoked Jellyfin token:', err),
    );
  }

  return NextResponse.json(
    {
      error: 'jellyfin_connect_required',
      message: 'Connect your Jellyfin account to watch.',
    },
    { status: 409 },
  );
}
