import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { reapDeviceSessions } from '@/lib/jellyfin-playback/session-reaper';

/**
 * Clear whatever this device left playing when it was last killed.
 *
 * The player calls this on startup, once, when it has nothing of its own
 * playing. iOS fires no lifecycle event when a standalone PWA is terminated
 * from the app switcher, so the Stopped report never goes out and the session
 * and its transcode outlive the app; opening the app again is the earliest
 * moment that can be noticed from this device's side. The reaper catches the
 * same sessions on its own schedule — this only makes the common case
 * immediate rather than a couple of minutes late.
 */
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.view');
  if (!auth.ok) return auth.response;

  let body: { deviceId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const deviceId = typeof body.deviceId === 'string' ? body.deviceId : '';
  if (!deviceId || deviceId.length > 128) {
    return NextResponse.json({ error: 'deviceId is required' }, { status: 400 });
  }

  try {
    const ended = await reapDeviceSessions(deviceId);
    return NextResponse.json({ ok: true, ended });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to clear abandoned sessions');
  }
}

export const POST = withApiLogging(postHandler, 'api/jellyfin/stream/orphans');
