import { NextRequest, NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { sanitizeDays } from '@/lib/jellyfin-playback-query';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.stats');
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const days = sanitizeDays(searchParams.get('days'), 30);
    const endDate = searchParams.get('endDate') || undefined;
    const client = await getJellyfinClient();
    const users = await client.getPlaybackUserActivity(days, endDate);
    return NextResponse.json({ users: users ?? [], pluginAvailable: users !== null });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch playback user activity');
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/playback/users');
