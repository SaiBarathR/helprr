import { NextRequest, NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { parsePageParams } from '@/lib/pagination';

/**
 * Handle GET requests to retrieve Prowlarr history.
 *
 * Accepts query parameters: `page` (default 1), `pageSize` (default 50), `indexerId` (optional), `eventType` (optional), and `successful` (optional, `'true'` or `'false'`). Obtains a Prowlarr client, fetches history using the parsed parameters, and returns the result as JSON.
 *
 * @param request - Incoming Next.js request containing the query parameters described above
 * @returns A JSON response containing the fetched history on success. On error, a JSON object `{ error: string }` is returned with HTTP status 500.
 */
// A filter is applied only when it is a whole number in range. Anything else is
// ignored, as if it had not been sent: clamping an id would filter by another one.
function optionalWholeNumber(value: string | null, min: number): number | undefined {
  if (value === null || !/^\d{1,10}$/.test(value)) return undefined;
  const n = Number(value);
  return n >= min && n <= 2_147_483_647 ? n : undefined;
}

async function getHandler(request: NextRequest) {
  const auth = await requireUserCapability('prowlarr.view');
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const { page, pageSize } = parsePageParams(searchParams, { defaultSize: 50, maxSize: 200 });
    const indexerId = optionalWholeNumber(searchParams.get('indexerId'), 1);
    const eventType = optionalWholeNumber(searchParams.get('eventType'), 0);
    const successfulParam = searchParams.get('successful');
    const successful = successfulParam !== null ? successfulParam === 'true' : undefined;

    const client = await getProwlarrClient();
    const history = await client.getHistory({ page, pageSize, indexerId, eventType, successful });
    return NextResponse.json(history);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch history');
  }
}

export const GET = withApiLogging(getHandler, 'api/prowlarr/history');
