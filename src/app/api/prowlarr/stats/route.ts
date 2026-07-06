import { NextRequest, NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

/**
 * Handle GET requests and return indexer statistics from a Prowlarr client.
 *
 * Reads an optional `startDate` query parameter from the request URL and uses it to filter the stats returned by the Prowlarr client.
 *
 * @param request - Incoming request whose URL may include an optional `startDate` query parameter used to filter returned statistics
 * @returns The indexer statistics as a JSON payload on success; on failure, a JSON object `{ error: string }` with HTTP status 500
 */
async function getHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('prowlarr.view');
  if (capError) return capError;

  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate') ?? undefined;
    const client = await getProwlarrClient();
    const stats = await client.getIndexerStats(startDate ? { startDate } : {});
    return NextResponse.json(stats);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch indexer stats');
  }
}

export const GET = withApiLogging(getHandler, 'api/prowlarr/stats');
