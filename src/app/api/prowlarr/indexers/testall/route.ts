import { NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

/**
 * Handle POST requests to test all Prowlarr indexers and return the test outcome.
 *
 * @returns A normalized JSON response containing per-indexer test results and pass/fail counts on success; on failure returns `{ error: string }` with HTTP status 500 describing the error.
 */
async function postHandler() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const client = await getProwlarrClient();
    const result = await client.testAllIndexers();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Test All failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = withApiLogging(postHandler, 'api/prowlarr/indexers/testall');
