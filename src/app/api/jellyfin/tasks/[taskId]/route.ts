import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function postHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  const capError = await requireCapability('jellyfin.control');
  if (capError) return capError;

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
  const authError = await requireAuth();
  if (authError) return authError;

  const capError = await requireCapability('jellyfin.control');
  if (capError) return capError;

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
