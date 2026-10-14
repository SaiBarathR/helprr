import { NextRequest, NextResponse } from 'next/server';
import { requireUserAnyCapability } from '@/lib/auth';
import { getDiscoverCollectionDetail } from '@/lib/discover-collection';
import { TmdbRateLimitError } from '@/lib/tmdb-client';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireUserAnyCapability(['discover.view', 'movies.view', 'series.view', 'recommendations.view', 'watchlist.view']);
  if (!auth.ok) return auth.response;

  try {
    const { id: idStr } = await params;
    const id = Number(idStr);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'Invalid collection ID' }, { status: 400 });
    }

    return NextResponse.json(await getDiscoverCollectionDetail(id));
  } catch (error) {
    if (error instanceof TmdbRateLimitError) {
      return NextResponse.json(
        {
          error: 'TMDB rate limit reached',
          code: 'TMDB_RATE_LIMIT',
          retryAfterSeconds: error.retryAfterSeconds,
          retryAt: error.retryAt,
        },
        { status: 429 }
      );
    }
    return upstreamErrorResponse(error, 'Failed to load collection');
  }
}

export const GET = withApiLogging(getHandler, 'api/discover/collection/[id]');
