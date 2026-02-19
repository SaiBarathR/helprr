import { NextRequest, NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';

/**
 * Handle POST requests to trigger a Prowlarr indexer test for the route `.../indexers/[id]/test`.
 *
 * @param _request - The incoming NextRequest (unused).
 * @param params - A promise resolving to route parameters; must include `id` (the indexer id).
 * @returns On success, a JSON response containing the indexer test result (or `{ success: true }` when the result is falsy). On failure, a JSON response `{ error: string }` with HTTP status 500.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const client = await getProwlarrClient();
    const result = await client.testIndexer(parseInt(id, 10));
    return NextResponse.json(result ?? { success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Test failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}