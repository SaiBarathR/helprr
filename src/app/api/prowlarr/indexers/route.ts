import { NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { toProwlarrIndexerSummary } from '@/lib/prowlarr-client';

/**
 * Retrieve the list of indexers from the Prowlarr client and return them as JSON,
 * trimmed to the summary the pages use (no settings fields).
 *
 * @returns The indexer summaries as a JSON response; on failure returns a JSON object with an `error` message and HTTP status 500.
 */
async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('prowlarr.view');
  if (!auth.ok) return auth.response;

  try {
    const client = await getProwlarrClient();
    const indexers = await client.getIndexers();
    return NextResponse.json(indexers.map(toProwlarrIndexerSummary));
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch indexers');
  }
}

export const GET = withApiLogging(getHandler, 'api/prowlarr/indexers');
