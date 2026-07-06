import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import type { SonarrLookupResult } from '@/types';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const term = searchParams.get('term');
    if (!term) {
      return NextResponse.json({ error: 'Missing search term' }, { status: 400 });
    }
    const instanceId = request.nextUrl.searchParams.get('instanceId') ?? undefined;
    const client = await getSonarrClient(instanceId);
    const results = await client.lookupSeries(term);
    const annotatedResults: SonarrLookupResult[] = results.map((show) => ({
      ...show,
      library: (typeof show.id === 'number' && show.id > 0)
        ? { exists: true, type: 'series', id: show.id }
        : { exists: false },
    }));
    return NextResponse.json(annotatedResults);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to lookup series');
  }
}

export const GET = withApiLogging(getHandler, 'api/sonarr/lookup');
