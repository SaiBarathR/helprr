import { NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

/**
 * Handle GET requests for Prowlarr indexer statuses.
 *
 * @returns The indexer statuses as JSON, or on failure a JSON object with an `error` message and HTTP status 500.
 */
async function getHandler() {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('prowlarr.view');
  if (capError) return capError;

  try {
    const client = await getProwlarrClient();
    const statuses = await client.getIndexerStatuses();
    return NextResponse.json(statuses);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch indexer statuses';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/prowlarr/status');
