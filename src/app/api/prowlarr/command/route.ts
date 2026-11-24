import { NextRequest, NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

// The commands Helprr's UI sends. Prowlarr's command endpoint also runs
// ApplicationUpdate, Backup, ClearHistory, DeleteLogFiles and more, which a
// grant to manage indexers must not reach. Add a name here with its UI.
const ALLOWED_COMMANDS = new Set(['ApplicationIndexerSync']);

/**
 * Handle POST requests that send a named command to a Prowlarr instance.
 *
 * Expects a JSON body with a `name` from ALLOWED_COMMANDS and, for ApplicationIndexerSync, an optional
 * `forceSync` (true re-sends every indexer's settings to the apps, even ones Prowlarr thinks unchanged).
 * On success returns the command result as JSON.
 *
 * @returns On success, the JSON response from Prowlarr. A missing or unknown `name` is a 400 and nothing is sent. On other failures, a 500 response with `{ error: string }` describing the failure.
 */
async function postHandler(request: NextRequest) {
  const auth = await requireUserCapability('prowlarr.manage');
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const name: unknown = body?.name;

    if (typeof name !== 'string' || !name) {
      return NextResponse.json({ error: 'Command name is required' }, { status: 400 });
    }
    if (!ALLOWED_COMMANDS.has(name)) {
      return NextResponse.json({ error: 'Unknown command' }, { status: 400 });
    }
    const forceSync: unknown = body?.forceSync;
    if (forceSync !== undefined && typeof forceSync !== 'boolean') {
      return NextResponse.json({ error: 'forceSync must be true or false' }, { status: 400 });
    }

    const client = await getProwlarrClient();
    const result = forceSync ? await client.sendCommand(name, { forceSync }) : await client.sendCommand(name);
    return NextResponse.json(result);
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to send command');
  }
}

export const POST = withApiLogging(postHandler, 'api/prowlarr/command');
