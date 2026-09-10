import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function postHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.control');
  if (!auth.ok) return auth.response;

  try {
    const { taskId } = await params;
    const client = await getJellyfinClient();
    await client.startScheduledTask(taskId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to start task');
  }
}

async function deleteHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.control');
  if (!auth.ok) return auth.response;

  try {
    const { taskId } = await params;
    const client = await getJellyfinClient();
    await client.stopScheduledTask(taskId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to stop task');
  }
}

export const POST = withApiLogging(postHandler, 'api/jellyfin/tasks/[taskId]');
export const DELETE = withApiLogging(deleteHandler, 'api/jellyfin/tasks/[taskId]');
