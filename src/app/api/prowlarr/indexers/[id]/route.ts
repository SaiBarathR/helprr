import { NextRequest, NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

/**
 * Deletes the Prowlarr indexer identified by the route `id` parameter.
 *
 * @param params - Promise that resolves to route parameters; must include `id` as the indexer identifier string.
 * @returns A JSON response: `{ success: true }` on success, or `{ error: string }` with HTTP status 500 on failure.
 */
async function deleteHandler(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id } = await params;
    const parsedId = Number.parseInt(id, 10);
    if (!/^\d+$/.test(id) || Number.isNaN(parsedId)) {
      return NextResponse.json({ error: 'Invalid indexer id' }, { status: 400 });
    }
    const client = await getProwlarrClient();
    await client.deleteIndexer(parsedId);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete indexer';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const DELETE = withApiLogging(deleteHandler, 'api/prowlarr/indexers/[id]');
