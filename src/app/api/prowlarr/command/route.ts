import { NextRequest, NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';

/**
 * Handle POST requests that send a named command to a Prowlarr instance.
 *
 * Expects a JSON body with a required `name` field. On success returns the command result as JSON.
 *
 * @returns On success, the JSON response from Prowlarr. If `name` is missing, a 400 response with `{ error: 'Command name is required' }`. On other failures, a 500 response with `{ error: string }` describing the failure.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name } = body;

    if (!name) {
      return NextResponse.json({ error: 'Command name is required' }, { status: 400 });
    }

    const client = await getProwlarrClient();
    const result = await client.sendCommand(name);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send command';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}