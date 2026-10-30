import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';

async function postHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.view');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as { seen?: unknown; hidden?: unknown } | null;
  const seen = typeof body?.seen === 'boolean' ? body.seen : undefined;
  const hidden = typeof body?.hidden === 'boolean' ? body.hidden : undefined;
  if (seen === undefined && hidden === undefined) {
    return NextResponse.json({ error: 'seen or hidden is required' }, { status: 400 });
  }

  const { id: videoId } = await params;
  const video = await prisma.twitchVideo.findUnique({ where: { id: videoId }, select: { id: true } });
  if (!video) return NextResponse.json({ error: 'Video not found' }, { status: 404 });

  const data = {
    ...(seen === undefined ? {} : { seenAt: seen ? new Date() : null }),
    ...(hidden === undefined ? {} : { hidden }),
  };
  await prisma.twitchUserVideoState.upsert({
    where: { userId_videoId: { userId: auth.user.id, videoId } },
    update: data,
    create: { userId: auth.user.id, videoId, ...data },
  });
  return NextResponse.json({ ok: true });
}

export const POST = withApiLogging(postHandler, 'api/twitch/videos/[id]/state');
