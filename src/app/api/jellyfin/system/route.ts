import { NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler(): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  const capError = await requireCapability('jellyfin.control');
  if (capError) return capError;

  try {
    const client = await getJellyfinClient();
    const system = await client.getSystemInfo();
    return NextResponse.json({ system });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch system info');
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/system');
