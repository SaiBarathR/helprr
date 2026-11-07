import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { can } from '@/lib/permissions';
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
      _count: { select: { subscriptions: true } },
    },
  });
  if (!playlist) return NextResponse.json({ error: 'Playlist not found' }, { status: 404 });

  const { subscriptions, _count, ...rest } = playlist;
  // Who follows is for whoever sets the rules: it decides whether they still run.
  const followers = can(auth.user, 'youtube.manage') ? { followers: _count.subscriptions } : {};
  return NextResponse.json({ ...rest, subscription: subscriptions[0] ?? null, ...followers });
}

export const GET = withApiLogging(getHandler, 'api/youtube/playlists/[id]');
