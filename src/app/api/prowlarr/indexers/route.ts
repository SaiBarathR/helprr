import { NextRequest, NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';

/**
 * Retrieve the list of indexers from the Prowlarr client and return them as JSON.
 *
 * @returns The fetched indexers as a JSON response; on failure returns a JSON object with an `error` message and HTTP status 500.
 */
async function getHandler(): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const client = await getProwlarrClient();
    const indexers = await client.getIndexers();
    return NextResponse.json(indexers);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch indexers';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Handle POST requests to either test all Prowlarr indexers or add a new indexer.
 *
 * @param request - Incoming HTTP request whose JSON body should be either `{ action: "testall" }` to run tests for all indexers, or an indexer configuration object to be added.
 * @returns A JSON HTTP response containing normalized test results or the added indexer on success; on error, a JSON object with an `error` message and HTTP status 500.
 */
async function postHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const record = body as Record<string, unknown>;
    const client = await getProwlarrClient();

    if ('action' in record) {
      const action = record.action;
      if (typeof action !== 'string') {
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
      }
      if (action !== 'testall') {
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
      }
      const result = await client.testAllIndexers();
      return NextResponse.json(result);
    }

    // Otherwise treat as add indexer
    const indexer = await client.addIndexer(body);
    return NextResponse.json(indexer);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to perform action';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/prowlarr/indexers');
export const POST = withApiLogging(postHandler, 'api/prowlarr/indexers');
