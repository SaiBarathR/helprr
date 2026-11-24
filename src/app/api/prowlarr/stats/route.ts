import { NextRequest, NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

// What the Stats tab, the stats widget and Insights send: a UTC ISO time.
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/**
 * Handle GET requests and return indexer statistics from a Prowlarr client.
 *
 * Reads an optional `startDate` query parameter from the request URL and uses it to filter the stats returned by the Prowlarr client.
 * It must be a UTC ISO time; anything else is a 400 and Prowlarr is not called.
 *
 * @param request - Incoming request whose URL may include an optional `startDate` query parameter used to filter returned statistics
 * @returns The indexer statistics as a JSON payload on success; on failure, a JSON object `{ error: string }` with HTTP status 500
 */
async function getHandler(request: NextRequest) {
  const auth = await requireUserCapability('prowlarr.view');
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const rawStartDate = searchParams.get('startDate');
    let startDate: string | undefined;
    if (rawStartDate !== null) {
      const time = ISO_UTC.test(rawStartDate) ? Date.parse(rawStartDate) : NaN;
      if (!Number.isFinite(time)) {
        return NextResponse.json({ error: 'startDate must be an ISO date and time in UTC' }, { status: 400 });
      }
      // Sent as Helprr wrote it, not as the caller spelled it.
      startDate = new Date(time).toISOString();
    }
    const client = await getProwlarrClient();
    const stats = await client.getIndexerStats(startDate ? { startDate } : {});
    return NextResponse.json(stats);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch indexer stats');
  }
}

export const GET = withApiLogging(getHandler, 'api/prowlarr/stats');
