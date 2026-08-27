import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClientForUser, JellyfinNotLinkedError } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import type { LiveTvResponse } from '@/types/jellyfin-streaming';

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.view');
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const channelIds = searchParams.get('channelIds') ?? undefined;
    const client = await getJellyfinClientForUser(auth.user);
    const [channels, programs, recordings] = await Promise.all([
      client.getLiveTvChannels({ limit: 400 }),
      client.getLiveTvPrograms({
        HasAired: false,
        Limit: 400,
        EnableImages: true,
        ...(channelIds ? { ChannelIds: channelIds } : {}),
      }).catch(() => ({ Items: [] })),
      client.getLiveTvRecordings(40).catch(() => ({ Items: [] })),
    ]);
    return NextResponse.json({
      linked: true,
      channels: channels.Items ?? [],
      programs: programs.Items ?? [],
      recordings: recordings.Items ?? [],
    } satisfies LiveTvResponse);
  } catch (error) {
    if (error instanceof JellyfinNotLinkedError) {
      return NextResponse.json({ linked: false, channels: [], programs: [], recordings: [] } satisfies LiveTvResponse);
    }
    return upstreamErrorResponse(error, 'Failed to load Live TV');
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/catalog/live');
