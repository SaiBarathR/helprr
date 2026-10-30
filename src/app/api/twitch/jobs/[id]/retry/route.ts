import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';

async function postHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.download');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const { count } = await prisma.twitchJob.updateMany({
    where: { id, state: { in: ['FAILED', 'CANCELLED'] } },
    data: {
      state: 'QUEUED',
      attempts: 0,
      runAfter: new Date(),
      cancelRequested: false,
      errorClass: null,
      lastError: null,
      stage: null,
      progress: null,
      finishedAt: null,
    },
  });
  if (count === 0) return NextResponse.json({ error: 'Only a failed or cancelled job can be retried' }, { status: 409 });
  return NextResponse.json({ ok: true });
}

export const POST = withApiLogging(postHandler, 'api/twitch/jobs/[id]/retry');
