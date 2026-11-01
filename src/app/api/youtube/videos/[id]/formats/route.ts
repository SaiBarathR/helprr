import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { ACTIVE_JOB_STATES } from '@/lib/archive/jobs';
import { prisma } from '@/lib/db';
import { YOUTUBE } from '@/lib/youtube/platform';

const FRESH_MS = 6 * 3_600_000;

type RouteContext = { params: Promise<{ id: string }> };

const isFresh = (checkedAt: Date | null) => Boolean(checkedAt) && Date.now() - checkedAt!.getTime() < FRESH_MS;

const activeLookup = (videoId: string) => prisma.archiveJob.findFirst({
  where: { videoId, kind: 'FORMATS', state: { in: ACTIVE_JOB_STATES } },
  select: { id: true },
});

/** What the worker found, or nothing yet. Sizes only: no format link is ever stored. */
async function getHandler(_request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.view');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const video = await prisma.creatorVideo.findUnique({ where: { id, platform: YOUTUBE }, select: { formats: true, formatsCheckedAt: true } });
  if (!video) return NextResponse.json({ error: 'Video not found' }, { status: 404 });
  const fresh = isFresh(video.formatsCheckedAt);
  return NextResponse.json({ formats: fresh ? video.formats : null, pending: !fresh && Boolean(await activeLookup(id)) });
}

/** Asks the worker to look, unless it already has. */
async function postHandler(_request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.download');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const video = await prisma.creatorVideo.findUnique({ where: { id, platform: YOUTUBE }, select: { formatsCheckedAt: true } });
  if (!video) return NextResponse.json({ error: 'Video not found' }, { status: 404 });
  if (!isFresh(video.formatsCheckedAt) && !(await activeLookup(id))) {
    await prisma.archiveJob.create({
      data: {
        platform: YOUTUBE,
        kind: 'FORMATS',
        videoId: id,
        source: 'MANUAL',
        requestedByUserId: auth.user.id,
        requestedByUsername: auth.user.username,
      },
    });
  }
  return NextResponse.json({ ok: true });
}

export const GET = withApiLogging(getHandler, 'api/youtube/videos/[id]/formats');
export const POST = withApiLogging(postHandler, 'api/youtube/videos/[id]/formats');
