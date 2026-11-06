import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { can } from '@/lib/permissions';
import { TWITCH } from '@/lib/twitch/platform';

async function getHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.view');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const streamer = await prisma.creator.findUnique({
    where: { id, platform: TWITCH },
    select: {
      id: true, login: true, displayName: true, description: true, profileImageUrl: true,
      offlineImageUrl: true, broadcasterType: true, isLive: true, liveTitle: true, liveCategory: true,
      subscriptions: { where: { userId: auth.user.id }, select: { id: true, notifyNewVods: true } },
      _count: { select: { subscriptions: true } },
    },
  });
  if (!streamer) return NextResponse.json({ error: 'Streamer not found' }, { status: 404 });

  const { subscriptions, _count, ...rest } = streamer;
  // Who follows is for whoever sets the rules: it decides whether they still run.
  const followers = can(auth.user, 'twitch.manage') ? { followers: _count.subscriptions } : {};
  return NextResponse.json({ ...rest, subscription: subscriptions[0] ?? null, ...followers });
}

export const GET = withApiLogging(getHandler, 'api/twitch/streamers/[id]');
