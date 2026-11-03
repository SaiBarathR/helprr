import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { followChannel } from '@/lib/youtube/channels';
import { parseChannelInput } from '@/lib/youtube/ids';
import { YOUTUBE } from '@/lib/youtube/platform';
import { youtubeErrorResponse } from '@/lib/youtube/route-errors';

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.view');
  if (!auth.ok) return auth.response;

  const subscriptions = await prisma.creatorSubscription.findMany({
    where: { userId: auth.user.id, creator: { platform: YOUTUBE } },
    orderBy: { creator: { displayName: 'asc' } },
    select: {
      id: true,
      notifyNewVods: true,
      creator: { select: { id: true, externalId: true, login: true, displayName: true, profileImageUrl: true, isLive: true, liveTitle: true } },
    },
  });
  return NextResponse.json({ subscriptions });
}

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.view');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as { input?: unknown } | null;
  const query = typeof body?.input === 'string' ? parseChannelInput(body.input) : null;
  if (!query) return NextResponse.json({ error: 'Enter an @handle or a channel link' }, { status: 400 });

  try {
    const result = await followChannel(auth.user.id, query);
    if (!result) return NextResponse.json({ error: 'No YouTube channel has that handle' }, { status: 404 });
    return NextResponse.json({ channelId: result.creator.id, subscriptionId: result.subscription.id });
  } catch (error) {
    return youtubeErrorResponse(error);
  }
}

export const GET = withApiLogging(getHandler, 'api/youtube/channels');
export const POST = withApiLogging(postHandler, 'api/youtube/channels');
