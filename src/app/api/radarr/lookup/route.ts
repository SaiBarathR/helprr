import { NextRequest, NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import type { RadarrLookupResult } from '@/types';
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
    const client = await getRadarrClient(instanceId);
    const results = await client.lookupMovie(term);
    const annotatedResults: RadarrLookupResult[] = results.map((movie) => ({
      ...movie,
      library: (typeof movie.id === 'number' && movie.id > 0)
        ? { exists: true, type: 'movie', id: movie.id }
        : { exists: false },
    }));
    return NextResponse.json(annotatedResults);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to lookup movie');
  }
}

export const GET = withApiLogging(getHandler, 'api/radarr/lookup');
