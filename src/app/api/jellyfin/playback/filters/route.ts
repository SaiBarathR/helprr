import { NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.stats');
  if (!auth.ok) return auth.response;

  try {
    const client = await getJellyfinClient();
    const filters = await client.getTypeFilterList();
    return NextResponse.json({ filters: filters ?? [], pluginAvailable: filters !== null });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch type filters');
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/playback/filters');
