import { NextRequest, NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';

/**
 * Retrieve the list of indexers from the Prowlarr client and return them as JSON.
 *
 * @returns The fetched indexers as a JSON response; on failure returns a JSON object with an `error` message and HTTP status 500.
 */
export async function GET() {
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
 * @returns A JSON HTTP response containing the test results or the added indexer on success; on error, a JSON object with an `error` message and HTTP status 500.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const client = await getProwlarrClient();

    if (body.action === 'testall') {
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