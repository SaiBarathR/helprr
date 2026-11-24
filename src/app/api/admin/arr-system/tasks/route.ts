import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { logger } from '@/lib/logger';
import { RUNNABLE_TASKS } from '@/lib/arr-system';
import { NO_STORE, resolveSystemTarget, toCommandResult, toSystemTasks } from '@/lib/server/arr-system';

// One instance's scheduled tasks (System → Tasks), and Run now for the ones in
// RUNNABLE_TASKS. Admins only: the tasks are app-wide (an RSS Sync asks every
// indexer, a refresh rescans the whole library).
async function getHandler(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const resolved = await resolveSystemTarget(request.nextUrl.searchParams.get('instanceId'));
    if (!resolved.ok) return resolved.response;
    const { client, type } = resolved.target;
    return NextResponse.json(toSystemTasks(await client.getSystemTasks(), RUNNABLE_TASKS[type]), { headers: NO_STORE });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch tasks');
  }
}

async function postHandler(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const body: unknown = await request.json().catch(() => null);
    const name = body && typeof body === 'object' ? (body as { name?: unknown }).name : undefined;
    if (typeof name !== 'string' || !name) {
      return NextResponse.json({ error: 'Task name is required' }, { status: 400 });
    }
    const resolved = await resolveSystemTarget(request.nextUrl.searchParams.get('instanceId'));
    if (!resolved.ok) return resolved.response;
    const { client, type, instanceId } = resolved.target;
    // Checked against the instance's own app before anything is sent.
    if (!RUNNABLE_TASKS[type].has(name)) {
      return NextResponse.json({ error: 'This task cannot be run from Helprr' }, { status: 400 });
    }
    const result = toCommandResult(await client.runTask(name));
    logger.info('Scheduled task run now', {
      userId: auth.user.id,
      username: auth.user.username,
      instanceId,
      command: name,
      commandId: result.id,
    }, { scope: type.toLowerCase() });
    // The sheet needs only the id, to follow the run.
    return NextResponse.json(result);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to run task');
  }
}

export const GET = withApiLogging(getHandler, 'api/admin/arr-system/tasks');
export const POST = withApiLogging(postHandler, 'api/admin/arr-system/tasks');
