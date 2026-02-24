import { NextResponse } from 'next/server';
import { getSonarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';

/**
 * Handles GET requests for Sonarr download clients.
 *
 * @returns The JSON response containing the list of download clients on success, or an error object `{ error: string }` with HTTP status 500 on failure.
 */
export async function GET() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const client = await getSonarrClient();
    const clients = await client.getDownloadClients();
    return NextResponse.json(clients);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch download clients';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}