import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { serializeVideoRow, VIDEO_SELECT } from '@/lib/archive/serialize-video';
import { prisma } from '@/lib/db';
import { YOUTUBE } from '@/lib/youtube/platform';

async function getHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.view');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const video = await prisma.creatorVideo.findUnique({
    where: { id, platform: YOUTUBE },
    select: {
      ...VIDEO_SELECT,
      liveEndedAt: true,
      ageRestricted: true,
      userStates: { where: { userId: auth.user.id }, select: { seenAt: true, hidden: true } },
    },
  });
  if (!video) return NextResponse.json({ error: 'Video not found' }, { status: 404 });

  const { userStates, ...rest } = video;
  return NextResponse.json({ ...serializeVideoRow(rest, userStates[0]?.seenAt), hidden: userStates[0]?.hidden ?? false });
}

export const GET = withApiLogging(getHandler, 'api/youtube/videos/[id]');
