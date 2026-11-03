import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { serializeVideoRow, VIDEO_SELECT } from '@/lib/archive/serialize-video';
import { prisma } from '@/lib/db';
import { parsePageParams } from '@/lib/pagination';
import { YOUTUBE } from '@/lib/youtube/platform';

async function getHandler(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.view');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const { page, pageSize, skip, take } = parsePageParams(request.nextUrl.searchParams, { defaultSize: 30, maxSize: 100 });
  const where = { playlistId: id, playlist: { platform: YOUTUBE } };

  const [rows, total] = await Promise.all([
    prisma.creatorPlaylistVideo.findMany({ where, orderBy: { position: 'asc' }, skip, take, select: { video: { select: VIDEO_SELECT } } }),
    prisma.creatorPlaylistVideo.count({ where }),
  ]);
  return NextResponse.json({ videos: rows.map(({ video }) => serializeVideoRow(video)), total, page, pageSize });
}

export const GET = withApiLogging(getHandler, 'api/youtube/playlists/[id]/videos');
