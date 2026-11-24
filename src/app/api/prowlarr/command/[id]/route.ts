import { NextRequest, NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

/**
 * The status of a command the Prowlarr page started (pollCommand follows it).
 * Only its id, name and status are passed on: a command's body and message
 * can name paths and hosts.
 */
async function getHandler(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUserCapability('prowlarr.manage');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!/^\d{1,10}$/.test(id) || Number(id) === 0) {
    return NextResponse.json({ error: 'Invalid command id' }, { status: 400 });
  }

  try {
    const client = await getProwlarrClient();
    const command = await client.getCommand(Number(id));
    return NextResponse.json({ id: command.id, name: command.name, status: command.status });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch command');
  }
}

export const GET = withApiLogging(getHandler, 'api/prowlarr/command/[id]');
