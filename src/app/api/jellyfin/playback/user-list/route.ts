import { NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler() {
  const authError = await requireAuth();
  if (authError) return authError;

  const capError = await requireCapability('jellyfin.stats');
  if (capError) return capError;

  try {
    const client = await getJellyfinClient();
    const users = await client.getUserList();
    return NextResponse.json({ users: users ?? [], pluginAvailable: users !== null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch user list';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/playback/user-list');
