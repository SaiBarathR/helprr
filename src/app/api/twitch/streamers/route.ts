import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { TwitchNotConfiguredError } from '@/lib/twitch/helix';
import { parseTwitchLogin, subscribeToStreamer } from '@/lib/twitch/streamers';

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.view');
  if (!auth.ok) return auth.response;

  const subscriptions = await prisma.twitchSubscription.findMany({
    where: { userId: auth.user.id },
    orderBy: { streamer: { displayName: 'asc' } },
    select: {
      id: true,
      notifyNewVods: true,
      streamer: {
        select: {
          id: true, login: true, displayName: true, profileImageUrl: true,
          isLive: true, liveTitle: true, liveCategory: true, broadcasterType: true,
        },
      },
    },
  });
  return NextResponse.json({ subscriptions });
}

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.view');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as { login?: unknown } | null;
  const login = typeof body?.login === 'string' ? parseTwitchLogin(body.login) : null;
  if (!login) return NextResponse.json({ error: 'Enter a Twitch name or channel link' }, { status: 400 });

  try {
    const result = await subscribeToStreamer(auth.user.id, login);
    if (!result) return NextResponse.json({ error: 'No Twitch channel has that name' }, { status: 404 });
    return NextResponse.json({ streamerId: result.streamer.id, subscriptionId: result.subscription.id });
  } catch (error) {
    if (error instanceof TwitchNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: 'Could not reach Twitch' }, { status: 502 });
  }
}

export const GET = withApiLogging(getHandler, 'api/twitch/streamers');
export const POST = withApiLogging(postHandler, 'api/twitch/streamers');
