import { NextRequest, NextResponse } from 'next/server';
import type { TwitchVideoType } from '@prisma/client';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { parsePageParams } from '@/lib/pagination';
import { serializeVideo, VIDEO_SELECT } from '@/lib/twitch/serialize';

const TYPES = new Set<string>(['ARCHIVE', 'HIGHLIGHT', 'UPLOAD']);

async function getHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.view');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const { searchParams } = request.nextUrl;
  const { page, pageSize, skip, take } = parsePageParams(searchParams, { defaultSize: 30, maxSize: 100 });
  const type = searchParams.get('type');
  const where = { streamerId: id, ...(type && TYPES.has(type) ? { type: type as TwitchVideoType } : {}) };

  const [videos, total] = await Promise.all([
    prisma.twitchVideo.findMany({ where, orderBy: { twitchCreatedAt: 'desc' }, skip, take, select: VIDEO_SELECT }),
    prisma.twitchVideo.count({ where }),
  ]);
  return NextResponse.json({ videos: videos.map((video) => serializeVideo(video)), total, page, pageSize });
}

export const GET = withApiLogging(getHandler, 'api/twitch/streamers/[id]/videos');
