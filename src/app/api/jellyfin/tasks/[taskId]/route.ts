import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function postHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { taskId } = await params;
    const client = await getJellyfinClient();
    await client.startScheduledTask(taskId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start task';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function deleteHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { taskId } = await params;
    const client = await getJellyfinClient();
    await client.stopScheduledTask(taskId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to stop task';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = withApiLogging(postHandler, 'api/jellyfin/tasks/[taskId]');
export const DELETE = withApiLogging(deleteHandler, 'api/jellyfin/tasks/[taskId]');
