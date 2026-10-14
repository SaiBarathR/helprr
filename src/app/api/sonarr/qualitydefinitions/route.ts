import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { REFERENCE_CACHE_HEADERS } from '@/lib/cache/reference-headers';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('series.manageFiles');
  if (!auth.ok) return auth.response;

  try {
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getSonarrClient(instanceId);
    const defs = await client.getQualityDefinitions();
    return NextResponse.json(defs, { headers: REFERENCE_CACHE_HEADERS });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch quality definitions');
  }
}

export const GET = withApiLogging(getHandler, 'api/sonarr/qualitydefinitions');
