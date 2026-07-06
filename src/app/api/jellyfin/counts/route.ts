import { NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler(): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('jellyfin.view');
  if (capError) return capError;

  try {
    const client = await getJellyfinClient();
    const counts = await client.getItemCounts();
    return NextResponse.json({ counts });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch item counts');
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/counts');
