import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { enqueueFileDelete } from '@/lib/twitch/retention';

async function deleteHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.manage');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!(await enqueueFileDelete(id, auth.user))) return NextResponse.json({ error: 'File not found' }, { status: 404 });
  return NextResponse.json({ ok: true }, { status: 202 });
}

export const DELETE = withApiLogging(deleteHandler, 'api/twitch/files/[id]');
