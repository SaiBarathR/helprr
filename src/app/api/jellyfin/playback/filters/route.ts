import { NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler(): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  const capError = await requireCapability('jellyfin.stats');
  if (capError) return capError;

  try {
    const client = await getJellyfinClient();
    const filters = await client.getTypeFilterList();
    return NextResponse.json({ filters: filters ?? [], pluginAvailable: filters !== null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch type filters';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/playback/filters');
