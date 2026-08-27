import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClientForUser, JellyfinNotLinkedError } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.view');
  if (!auth.ok) return auth.response;

  let body: { playSessionId?: unknown; deviceId?: unknown; deviceName?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const playSessionId = typeof body.playSessionId === 'string' ? body.playSessionId : '';
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId : '';
  if (!playSessionId || !deviceId) {
    return NextResponse.json({ error: 'playSessionId and deviceId are required' }, { status: 400 });
  }

  try {
    const client = await getJellyfinClientForUser(auth.user);
    await client.stopActiveEncodings(
      playSessionId,
      deviceId,
      typeof body.deviceName === 'string' ? body.deviceName : 'Helprr',
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof JellyfinNotLinkedError) {
      return NextResponse.json({ error: 'Jellyfin account not linked' }, { status: 400 });
    }
    return upstreamErrorResponse(error, 'Failed to stop transcode');
  }
}

export const POST = withApiLogging(postHandler, 'api/jellyfin/stream/stop-encodings');
