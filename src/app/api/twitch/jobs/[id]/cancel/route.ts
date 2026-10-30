import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { can } from '@/lib/permissions';
import { ACTIVE_JOB_STATES } from '@/lib/twitch/jobs';

/** The requester may cancel their own job; twitch.manage may cancel anyone's. */
async function postHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const job = await prisma.twitchJob.findUnique({
    where: { id },
    select: { state: true, requestedByUserId: true },
  });
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });

  const own = can(auth.user, 'twitch.download') && job.requestedByUserId === auth.user.id;
  if (!own && !can(auth.user, 'twitch.manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // A job the worker has not claimed ends here; a running one is the worker's to stop.
  const { count } = await prisma.twitchJob.updateMany({
    where: { id, state: { in: ['QUEUED', 'BLOCKED', 'RETRY_WAIT'] } },
    data: { state: 'CANCELLED', finishedAt: new Date() },
  });
  if (count === 0) {
    const { count: running } = await prisma.twitchJob.updateMany({
      where: { id, state: { in: ACTIVE_JOB_STATES } },
      data: { cancelRequested: true },
    });
    if (running === 0) return NextResponse.json({ error: 'Job has already finished' }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}

export const POST = withApiLogging(postHandler, 'api/twitch/jobs/[id]/cancel');
