import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { YOUTUBE } from '@/lib/youtube/platform';

async function getHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.view');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const playlist = await prisma.creatorPlaylist.findUnique({
    where: { id, platform: YOUTUBE },
    select: {
      id: true, externalId: true, title: true, ownerName: true, description: true, thumbnailUrl: true, itemCount: true,
      subscriptions: { where: { userId: auth.user.id }, select: { id: true, notifyNewVideos: true } },
    },
  });
  if (!playlist) return NextResponse.json({ error: 'Playlist not found' }, { status: 404 });

  const { subscriptions, ...rest } = playlist;
  return NextResponse.json({ ...rest, subscription: subscriptions[0] ?? null });
}

export const GET = withApiLogging(getHandler, 'api/youtube/playlists/[id]');
