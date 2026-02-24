import { NextResponse } from 'next/server';
import { getRadarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';

/**
 * Handle GET requests to fetch Radarr download clients.
 *
 * @returns A JSON HTTP response containing the array of download clients on success, or a JSON object with an `error` message and HTTP status 500 on failure.
 */
export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const client = await getRadarrClient();
    const clients = await client.getDownloadClients();
    return NextResponse.json(clients);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch download clients';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}