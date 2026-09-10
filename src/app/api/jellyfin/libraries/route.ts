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
    const libraries = await client.getLibraries();
    return NextResponse.json({ libraries });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch libraries');
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/libraries');
