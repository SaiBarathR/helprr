import { NextRequest, NextResponse } from 'next/server';
import { getLidarrClient } from '@/lib/service-helpers';
import { requireUserAllCapabilities } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler(request: NextRequest): Promise<NextResponse> {
  // Only the interactive-release flow consumes this, which is activity.manage-gated.
  // Lidarr's items are music: managing them also needs music.view, as in Activity.
  const auth = await requireUserAllCapabilities(['activity.manage', 'music.view']);
  if (!auth.ok) return auth.response;

  try {
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getLidarrClient(instanceId);
    const clients = await client.getDownloadClients();
    return NextResponse.json(clients);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch download clients');
  }
}

export const GET = withApiLogging(getHandler, 'api/lidarr/downloadclient');
