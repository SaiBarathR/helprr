import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { parsePageParams } from '@/lib/pagination';
import { buildFeedWhere, feedCategories } from '@/lib/archive/feed';
import { VIDEO_SELECT } from '@/lib/archive/serialize-video';
import { serializeVideo } from '@/lib/twitch/serialize';
import { TWITCH } from '@/lib/twitch/platform';

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.view');
  if (!auth.ok) return auth.response;

  const { searchParams } = request.nextUrl;
  const { page, pageSize, skip, take } = parsePageParams(searchParams, { defaultSize: 30, maxSize: 60 });
  const where = await buildFeedWhere(TWITCH, auth.user.id, searchParams);

  const [videos, total, categories] = await Promise.all([
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
    feedCategories(TWITCH, auth.user.id),
  ]);

  return NextResponse.json({
    categories,
    videos: videos.map(({ userStates, ...video }) => serializeVideo(video, userStates[0]?.seenAt)),
    total,
    page,
    pageSize,
  });
}

export const GET = withApiLogging(getHandler, 'api/twitch/feed');
