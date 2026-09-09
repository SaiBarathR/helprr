import { NextRequest, NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

/**
 * Handle POST requests that send a named command to a Prowlarr instance.
 *
 * Expects a JSON body with a required `name` field. On success returns the command result as JSON.
 *
 * @returns On success, the JSON response from Prowlarr. If `name` is missing, a 400 response with `{ error: 'Command name is required' }`. On other failures, a 500 response with `{ error: string }` describing the failure.
 */
async function postHandler(request: NextRequest) {
  const auth = await requireUserCapability('prowlarr.manage');
  if (!auth.ok) return auth.response;

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
    return upstreamErrorResponse(error, 'Failed to send command');
  }
}

export const POST = withApiLogging(postHandler, 'api/prowlarr/command');
