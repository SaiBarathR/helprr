import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { invalidateOnCommandComplete } from '@/lib/cache/tagged-library';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireUserCapability('activity.manage');
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const commandId = Number(id);
    if (!Number.isInteger(commandId) || commandId <= 0) {
      return NextResponse.json({ error: 'Invalid command id' }, { status: 400 });
    }
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getRadarrClient(instanceId);
    const result = await client.getCommand(commandId);
    await invalidateOnCommandComplete('radarr', result, instanceId);
    return NextResponse.json(result);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch command');
  }
}

export const GET = withApiLogging(getHandler, 'api/radarr/command/[id]');
