import { NextRequest, NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

/**
 * Handle POST requests to trigger a Prowlarr indexer test for the route `.../indexers/[id]/test`.
 *
 * @param _request - The incoming NextRequest (unused).
 * @param params - A promise resolving to route parameters; must include `id` (the indexer id).
 * @returns On success, a JSON response containing the indexer test result (or `{ success: true }` when the result is falsy). On failure, a JSON response `{ error: string }` with HTTP status 500.
 */
async function postHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('prowlarr.manage');
  if (capError) return capError;

  try {
    const { id } = await params;
    const client = await getProwlarrClient();
    const result = await client.testIndexer(parseInt(id, 10));
    return NextResponse.json(result ?? { success: true });
  } catch (error) {
    return upstreamErrorResponse(error, 'Test failed');
  }
}

export const POST = withApiLogging(postHandler, 'api/prowlarr/indexers/[id]/test');
