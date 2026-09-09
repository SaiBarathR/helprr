import { NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler() {
  const auth = await requireUserCapability('jellyfin.control');
  if (!auth.ok) return auth.response;

  try {
    const client = await getJellyfinClient();
    const tasks = await client.getScheduledTasks();
    return NextResponse.json({ tasks });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch scheduled tasks');
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/tasks');
