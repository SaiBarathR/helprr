import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { buildFeedWhere } from '@/lib/archive/feed';
import { serializeVideoRow, VIDEO_SELECT } from '@/lib/archive/serialize-video';
import { parsePageParams } from '@/lib/pagination';
import { YOUTUBE } from '@/lib/youtube/platform';

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.view');
  if (!auth.ok) return auth.response;

  const { searchParams } = request.nextUrl;
  const { page, pageSize, skip, take } = parsePageParams(searchParams, { defaultSize: 30, maxSize: 60 });
  const where = await buildFeedWhere(YOUTUBE, auth.user.id, searchParams);

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

  return NextResponse.json({
    videos: videos.map(({ userStates, ...video }) => serializeVideoRow(video, userStates[0]?.seenAt)),
    total,
    page,
    pageSize,
  });
}

export const GET = withApiLogging(getHandler, 'api/youtube/feed');
