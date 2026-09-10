import { NextResponse } from 'next/server';
import { getJellyfinClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('jellyfin.control');
  if (!auth.ok) return auth.response;

  try {
    const client = await getJellyfinClient();
    const system = await client.getSystemInfo();
    return NextResponse.json({ system });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch system info');
  }
}

export const GET = withApiLogging(getHandler, 'api/jellyfin/system');
