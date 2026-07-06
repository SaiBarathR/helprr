import { NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler() {
  const authError = await requireAuth();
  if (authError) return authError;

  const capError = await requireCapability('jellyfin.sessions');
  if (capError) return capError;

  try {
    const client = await getJellyfinClient();
    const users = await client.getUsers();
    return NextResponse.json({ users });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch users');
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/users');
