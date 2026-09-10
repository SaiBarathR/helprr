import { NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler() {
  const auth = await requireUserCapability('jellyfin.stats');
  if (!auth.ok) return auth.response;

  try {
    const client = await getJellyfinClient();
    const users = await client.getUserList();
    return NextResponse.json({ users: users ?? [], pluginAvailable: users !== null });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch user list');
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/playback/user-list');
