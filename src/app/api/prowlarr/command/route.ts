import { NextRequest, NextResponse } from 'next/server';
import { getProwlarrClient } from '@/lib/service-helpers';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

// The commands Helprr's UI sends. Prowlarr's command endpoint also runs
// ApplicationUpdate, Backup, ClearHistory, DeleteLogFiles and more, which a
// grant to manage indexers must not reach. Add a name here with its UI.
// CheckHealth (the health banner's Re-check) only reruns Prowlarr's health
// checks: it changes no settings and deletes nothing.
const ALLOWED_COMMANDS = new Set(['ApplicationIndexerSync', 'CheckHealth']);

/**
 * Handle POST requests that send a named command to a Prowlarr instance.
 *
 * Expects a JSON body with a `name` from ALLOWED_COMMANDS. On success returns the command result as JSON.
 *
 * @returns On success, the command's id, name and status. A missing or unknown `name` is a 400 and nothing is sent. On other failures, a 500 response with `{ error: string }` describing the failure.
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

    const client = await getProwlarrClient();
    const result = await client.sendCommand(name);
    // As the status route: a command's body and message can name paths and hosts.
    return NextResponse.json({ id: result.id, name: result.name, status: result.status });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed to send command');
  }
}

export const POST = withApiLogging(postHandler, 'api/prowlarr/command');
