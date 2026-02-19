import { NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';

/**
 * Handle POST requests to test all Prowlarr indexers and return the test outcome.
 *
 * @returns A JSON response containing the indexer test results (the value returned by `testAllIndexers`, or `{ success: true }` when that value is falsy) on success; on failure returns `{ error: string }` with HTTP status 500 describing the error.
 */
export async function POST() {
  try {
    const client = await getProwlarrClient();
    const result = await client.testAllIndexers();
    return NextResponse.json(result ?? { success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Test All failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}