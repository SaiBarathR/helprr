import { NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler() {
  const auth = await requireUserCapability('jellyfin.sessions');
  if (!auth.ok) return auth.response;

  try {
    const client = await getJellyfinClient();
    const users = await client.getUsers();
    return NextResponse.json({ users });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch users');
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/users');
