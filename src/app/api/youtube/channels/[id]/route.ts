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
  const channel = await prisma.creator.findUnique({
    where: { id, platform: YOUTUBE },
    select: {
      id: true, login: true, displayName: true, description: true, profileImageUrl: true, offlineImageUrl: true,
      isLive: true, liveTitle: true,
      subscriptions: { where: { userId: auth.user.id }, select: { id: true, notifyNewVods: true } },
    },
  });
  if (!channel) return NextResponse.json({ error: 'Channel not found' }, { status: 404 });

  const { subscriptions, ...rest } = channel;
  return NextResponse.json({ ...rest, subscription: subscriptions[0] ?? null });
}

export const GET = withApiLogging(getHandler, 'api/youtube/channels/[id]');
