import { NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';

/**
 * Handle GET requests for Prowlarr indexer statuses.
 *
 * @returns The indexer statuses as JSON, or on failure a JSON object with an `error` message and HTTP status 500.
 */
export async function GET() {
  try {
    const client = await getProwlarrClient();
    const statuses = await client.getIndexerStatuses();
    return NextResponse.json(statuses);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch indexer statuses';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}