import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { requireUserAnyCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { REFERENCE_CACHE_HEADERS } from '@/lib/cache/reference-headers';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler(request: NextRequest) {
  const auth = await requireUserAnyCapability(['movies.view', 'movies.add']);
  if (!auth.ok) return auth.response;

  try {
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getRadarrClient(instanceId);
    const profiles = await client.getQualityProfiles();
    return NextResponse.json(profiles, { headers: REFERENCE_CACHE_HEADERS });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch quality profiles');
  }
}

export const GET = withApiLogging(getHandler, 'api/radarr/qualityprofiles');
