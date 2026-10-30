import { NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { startDeviceLink } from '@/lib/twitch/user-link';

async function postHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.view');
  if (!auth.ok) return auth.response;

  try {
    return NextResponse.json(await startDeviceLink(auth.user.id));
  } catch {
    return NextResponse.json({ error: 'Could not reach Twitch' }, { status: 502 });
  }
}

export const POST = withApiLogging(postHandler, 'api/twitch/follows/device', { logBodies: false });
