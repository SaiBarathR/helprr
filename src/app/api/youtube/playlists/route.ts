import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { parsePlaylistLink } from '@/lib/youtube/ids';
import { YOUTUBE } from '@/lib/youtube/platform';
import { followPlaylist } from '@/lib/youtube/playlists';
import { youtubeErrorResponse } from '@/lib/youtube/route-errors';

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.view');
  if (!auth.ok) return auth.response;

  const subscriptions = await prisma.creatorPlaylistSubscription.findMany({
    where: { userId: auth.user.id, playlist: { platform: YOUTUBE } },
    orderBy: { playlist: { title: 'asc' } },
    select: {
      id: true,
      notifyNewVideos: true,
      playlist: { select: { id: true, title: true, ownerName: true, thumbnailUrl: true, itemCount: true } },
    },
  });
  return NextResponse.json({ subscriptions });
}

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.view');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as { input?: unknown } | null;
  const playlistId = typeof body?.input === 'string' ? parsePlaylistLink(body.input) : null;
  if (!playlistId) return NextResponse.json({ error: 'Enter a playlist link' }, { status: 400 });

  try {
    const result = await followPlaylist(auth.user.id, playlistId);
    if (!result) return NextResponse.json({ error: 'That playlist is private or does not exist' }, { status: 404 });
    return NextResponse.json({ playlistId: result.playlist.id, subscriptionId: result.subscription.id });
  } catch (error) {
    return youtubeErrorResponse(error);
  }
}

export const GET = withApiLogging(getHandler, 'api/youtube/playlists');
export const POST = withApiLogging(postHandler, 'api/youtube/playlists');
