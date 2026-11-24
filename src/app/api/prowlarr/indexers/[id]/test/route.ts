import { NextRequest, NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

/**
 * Handle POST requests to trigger a Prowlarr indexer test for the route `.../indexers/[id]/test`.
 *
 * @param _request - The incoming NextRequest (unused).
 * @param params - A promise resolving to route parameters; must include `id` (the indexer id).
 * @returns On success, `{ ok: true }`. Prowlarr's own response is not passed on: like the
 * app test, nothing it sends back reaches the browser. On failure, a JSON response
 * `{ error: string }` with a fixed message.
 */
async function postHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const auth = await requireUserCapability('prowlarr.manage');
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const parsedId = Number.parseInt(id, 10);
    if (!/^\d+$/.test(id) || Number.isNaN(parsedId)) {
      return NextResponse.json({ error: 'Invalid indexer id' }, { status: 400 });
    }
    const client = await getProwlarrClient();
    await client.testIndexer(parsedId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return upstreamErrorResponse(error, 'Test failed');
  }
}

export const POST = withApiLogging(postHandler, 'api/prowlarr/indexers/[id]/test');
