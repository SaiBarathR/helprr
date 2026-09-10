import { NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.view');
  if (!auth.ok) return auth.response;

  try {
    const client = await getJellyfinClient();
    const counts = await client.getItemCounts();
    return NextResponse.json({ counts });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch item counts');
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/counts');
