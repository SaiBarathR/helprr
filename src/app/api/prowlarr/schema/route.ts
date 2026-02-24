import { NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';

/**
 * Handle GET requests to fetch Prowlarr indexer schemas.
 *
 * Obtains a Prowlarr client and returns its indexer schemas as JSON. If an error occurs, returns a JSON object with an `error` message and HTTP status 500.
 *
 * @returns A NextResponse containing the indexer schemas as JSON on success, or a JSON object `{ error: string }` with HTTP status 500 on failure.
 */
export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const client = await getProwlarrClient();
    const schemas = await client.getIndexerSchemas();
    return NextResponse.json(schemas);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch indexer schemas';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}