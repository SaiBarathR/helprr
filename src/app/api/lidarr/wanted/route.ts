import { NextRequest, NextResponse } from 'next/server';
import { getLidarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { parsePageParams } from '@/lib/pagination';

async function getHandler(request: NextRequest) {
  const auth = await requireUserCapability('music.view');
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const kind = searchParams.get('kind'); // 'cutoff' | 'missing' (default)
    const { page, pageSize } = parsePageParams(searchParams, { defaultSize: 20, maxSize: 100 });
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getLidarrClient(instanceId);
    const data = kind === 'cutoff'
      ? await client.getCutoffUnmet(page, pageSize)
      : await client.getWantedMissing(page, pageSize);
    return NextResponse.json(data);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch wanted albums');
  }
}

export const GET = withApiLogging(getHandler, 'api/lidarr/wanted');
