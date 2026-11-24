import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { parseArrId } from '@/lib/activity-arr-target';
import { invalidateOnCommandComplete } from '@/lib/cache/tagged-library';
import { NO_STORE, resolveSystemTarget, toCommandResult } from '@/lib/server/arr-system';

// A task started with Run now, followed until it ends (lib/arr-command.ts).
async function getHandler(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  try {
    const commandId = parseArrId((await params).id);
    if (!commandId) {
      return NextResponse.json({ error: 'Invalid command id' }, { status: 400 });
    }
    const resolved = await resolveSystemTarget(request.nextUrl.searchParams.get('instanceId'));
    if (!resolved.ok) return resolved.response;
    const { client, type, instanceId } = resolved.target;
    const result = toCommandResult(await client.getCommand(commandId));
    // A finished refresh drops Helprr's cached library, as the library
    // commands' own status route does.
    if (type !== 'PROWLARR') await invalidateOnCommandComplete(type.toLowerCase(), result, instanceId);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch task');
  }
}

export const GET = withApiLogging(getHandler, 'api/admin/arr-system/tasks/[id]');
