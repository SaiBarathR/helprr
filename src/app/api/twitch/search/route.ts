import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { helixGet, TwitchNotConfiguredError } from '@/lib/twitch/helix';
import { sizeThumbnail } from '@/lib/twitch/serialize';

interface HelixChannel {
  id: string;
  broadcaster_login: string;
  display_name: string;
  thumbnail_url: string;
  is_live: boolean;
  game_name: string;
}

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.view');
  if (!auth.ok) return auth.response;

  const q = request.nextUrl.searchParams.get('q')?.trim().slice(0, 100);
  if (!q) return NextResponse.json({ results: [] });

  try {
    const { data } = await helixGet<HelixChannel>('/search/channels', { query: q, first: 20 });
    return NextResponse.json({
      results: data.map((channel) => ({
        twitchUserId: channel.id,
        login: channel.broadcaster_login,
        displayName: channel.display_name,
        profileImageUrl: sizeThumbnail(channel.thumbnail_url),
        isLive: channel.is_live,
        category: channel.game_name || null,
      })),
    });
  } catch (error) {
    if (error instanceof TwitchNotConfiguredError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: 'Twitch search failed' }, { status: 502 });
  }
}

export const GET = withApiLogging(getHandler, 'api/twitch/search');
