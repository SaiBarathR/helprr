import { NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

/**
 * Handle GET requests to fetch Prowlarr indexer schemas.
 *
 * Obtains a Prowlarr client and returns its indexer schemas as JSON. If an error occurs, returns a JSON object with an `error` message and HTTP status 500.
 *
 * @returns A NextResponse containing the indexer schemas as JSON on success, or a JSON object `{ error: string }` with HTTP status 500 on failure.
 */
async function getHandler() {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('prowlarr.view');
  if (capError) return capError;

  try {
    const client = await getProwlarrClient();
    const schemas = await client.getIndexerSchemas();
    return NextResponse.json(schemas);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to fetch indexer schemas');
  }
}

export const GET = withApiLogging(getHandler, 'api/prowlarr/schema');
