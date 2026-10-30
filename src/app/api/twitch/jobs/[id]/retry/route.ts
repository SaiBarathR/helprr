import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { can } from '@/lib/permissions';
import { retryJob } from '@/lib/twitch/jobs';

/**
 * The requester may retry their own download; twitch.manage may retry anything.
 * A delete or a re-encode is only ever for twitch.manage, whoever first asked for it.
 */
async function postHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const job = await prisma.twitchJob.findUnique({ where: { id }, select: { kind: true, requestedByUserId: true } });
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  const manager = can(auth.user, 'twitch.manage');
  const ownDownload = job.kind === 'DOWNLOAD'
    && job.requestedByUserId === auth.user.id
    && can(auth.user, 'twitch.download');
  if (!manager && !ownDownload) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const result = await retryJob(id, { id: auth.user.id, username: auth.user.username });
  if (result === 'active') return NextResponse.json({ error: 'This video is already being downloaded' }, { status: 409 });
  if (result === 'not-retryable') return NextResponse.json({ error: 'Only a failed or cancelled job can be retried' }, { status: 409 });
  return NextResponse.json({ ok: true });
}

export const POST = withApiLogging(postHandler, 'api/twitch/jobs/[id]/retry');
