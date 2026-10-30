import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';

async function getHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.view');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const streamer = await prisma.twitchStreamer.findUnique({
    where: { id },
    select: {
      id: true, login: true, displayName: true, description: true, profileImageUrl: true,
      offlineImageUrl: true, broadcasterType: true, isLive: true, liveTitle: true, liveCategory: true,
      subscriptions: { where: { userId: auth.user.id }, select: { id: true, notifyNewVods: true } },
    },
  });
  if (!streamer) return NextResponse.json({ error: 'Streamer not found' }, { status: 404 });

  const { subscriptions, ...rest } = streamer;
  return NextResponse.json({ ...rest, subscription: subscriptions[0] ?? null });
}

export const GET = withApiLogging(getHandler, 'api/twitch/streamers/[id]');
