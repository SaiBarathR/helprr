import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { parsePageParams } from '@/lib/pagination';
import { buildFeedWhere } from '@/lib/archive/feed';
import { VIDEO_SELECT } from '@/lib/archive/serialize-video';
import { serializeVideo } from '@/lib/twitch/serialize';
import { TWITCH } from '@/lib/twitch/platform';

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.view');
  if (!auth.ok) return auth.response;

  const { searchParams } = request.nextUrl;
  const { page, pageSize, skip, take } = parsePageParams(searchParams, { defaultSize: 30, maxSize: 60 });
  const where = await buildFeedWhere(TWITCH, auth.user.id, searchParams);

  const [videos, total] = await Promise.all([
    prisma.creatorVideo.findMany({
      where,
      orderBy: [{ sourceCreatedAt: 'desc' }, { id: 'desc' }],
      skip,
      take,
      select: {
        ...VIDEO_SELECT,
        userStates: { where: { userId: auth.user.id }, select: { seenAt: true } },
      },
    }),
    prisma.creatorVideo.count({ where }),
  ]);

  // Only what is known: Helix has no category for a video, so older ones have none.
  const categories = await prisma.creatorVideo.findMany({
    where: { platform: TWITCH, creator: { subscriptions: { some: { userId: auth.user.id } } }, category: { not: null } },
    distinct: ['category'],
    orderBy: { category: 'asc' },
    select: { category: true },
    take: 100,
  });

  return NextResponse.json({
    categories: categories.map((row) => row.category),
    videos: videos.map(({ userStates, ...video }) => serializeVideo(video, userStates[0]?.seenAt)),
    total,
    page,
    pageSize,
  });
}

export const GET = withApiLogging(getHandler, 'api/twitch/feed');
