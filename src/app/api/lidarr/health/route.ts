import { NextRequest, NextResponse } from 'next/server';
import { getLidarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler(request: NextRequest) {
  const auth = await requireUserCapability('music.view');
  if (!auth.ok) return auth.response;

  try {
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getLidarrClient(instanceId);
    const health = await client.getHealth();
    return NextResponse.json(health);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch health');
  }
}

export const GET = withApiLogging(getHandler, 'api/lidarr/health');
