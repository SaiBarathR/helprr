import { NextRequest, NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';

/**
 * Deletes the Prowlarr indexer identified by the route `id` parameter.
 *
 * @param params - Promise that resolves to route parameters; must include `id` as the indexer identifier string.
 * @returns A JSON response: `{ success: true }` on success, or `{ error: string }` with HTTP status 500 on failure.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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