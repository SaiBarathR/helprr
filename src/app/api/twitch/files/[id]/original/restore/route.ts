import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { requestOriginalJob } from '@/lib/twitch/files';

async function postHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.manage');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const result = await requestOriginalJob(id, 'RESTORE_ORIGINAL', auth.user);
  if (result === 'missing') return NextResponse.json({ error: 'File not found' }, { status: 404 });
  if (result === 'nothing-to-do') return NextResponse.json({ error: 'There is no original to restore' }, { status: 409 });
  if (result === 'busy') return NextResponse.json({ error: 'Another job is working on this file' }, { status: 409 });
  return NextResponse.json({ ok: true }, { status: 202 });
}

export const POST = withApiLogging(postHandler, 'api/twitch/files/[id]/original/restore');
