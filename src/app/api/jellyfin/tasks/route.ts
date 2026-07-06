import { NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler() {
  const authError = await requireAuth();
  if (authError) return authError;

  const capError = await requireCapability('jellyfin.control');
  if (capError) return capError;

  try {
    const client = await getJellyfinClient();
    const tasks = await client.getScheduledTasks();
    return NextResponse.json({ tasks });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch scheduled tasks');
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/tasks');
