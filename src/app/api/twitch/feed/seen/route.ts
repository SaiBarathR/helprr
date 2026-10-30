import { NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { buildFeedWhere } from '@/lib/twitch/feed';

/** Marks everything currently under New as seen. */
async function postHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.view');
  if (!auth.ok) return auth.response;

  const userId = auth.user.id;
  const now = new Date();
  const where = await buildFeedWhere(userId, new URLSearchParams({ segment: 'new' }), now);
  const videos = await prisma.twitchVideo.findMany({ where, select: { id: true } });

  await prisma.$transaction([
    prisma.twitchUserVideoState.updateMany({
      where: { userId, videoId: { in: videos.map((video) => video.id) } },
      data: { seenAt: now },
    }),
    prisma.twitchUserVideoState.createMany({
      data: videos.map((video) => ({ userId, videoId: video.id, seenAt: now })),
      skipDuplicates: true,
    }),
  ]);
  return NextResponse.json({ marked: videos.length });
}

export const POST = withApiLogging(postHandler, 'api/twitch/feed/seen');
