import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { YOUTUBE } from '@/lib/youtube/platform';
import { youtubeErrorResponse } from '@/lib/youtube/route-errors';
import { syncChannelVideos } from '@/lib/youtube/sync';

/** Get latest videos, now. What it finds is still announced by the next poll. */
async function postHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.view');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const channel = await prisma.creator.findUnique({ where: { id, platform: YOUTUBE } });
  if (!channel) return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
  try {
    const { newVideoIds } = await syncChannelVideos(channel);
    return NextResponse.json({ found: newVideoIds.length });
  } catch (error) {
    return youtubeErrorResponse(error);
  }
}

export const POST = withApiLogging(postHandler, 'api/youtube/channels/[id]/sync');
