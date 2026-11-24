import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

// Every history record of one series, across its episodes (Sonarr's series History).
async function getHandler(request: NextRequest) {
  const auth = await requireUserCapability('series.view');
  if (!auth.ok) return auth.response;

  try {
    const seriesId = Number(request.nextUrl.searchParams.get('seriesId'));
    if (!Number.isInteger(seriesId) || seriesId <= 0) {
      return NextResponse.json({ error: 'seriesId is required' }, { status: 400 });
    }

    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getSonarrClient(instanceId);
    const history = await client.getSeriesHistory(seriesId);
    return NextResponse.json(history);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch series history');
  }
}

export const GET = withApiLogging(getHandler, 'api/sonarr/history/series');
