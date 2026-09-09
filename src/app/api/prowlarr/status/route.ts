import { NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

/**
 * Handle GET requests for Prowlarr indexer statuses.
 *
 * @returns The indexer statuses as JSON, or on failure a JSON object with an `error` message and HTTP status 500.
 */
async function getHandler() {
  const auth = await requireUserCapability('prowlarr.view');
  if (!auth.ok) return auth.response;

  try {
    const client = await getProwlarrClient();
    const statuses = await client.getIndexerStatuses();
    return NextResponse.json(statuses);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch indexer statuses');
  }
}

export const GET = withApiLogging(getHandler, 'api/prowlarr/status');
