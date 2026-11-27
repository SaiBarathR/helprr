import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { boundedBodyErrorResponse, readBoundedJson } from '@/lib/server/bounded-body';
import { resolveActivityArrTarget } from '@/lib/activity-arr-target';
import { logger } from '@/lib/logger';
import type { RadarrClient } from '@/lib/radarr-client';

// RSS Sync asks every indexer for its feed, a refresh without ids refreshes
// and rescans every movie from TMDB, and RefreshCollections reloads every
// collection: heavy, so admins only, kept apart from the per-title commands in
// /api/radarr/command.
type LibraryCommand = Parameters<RadarrClient['runLibraryCommand']>[0];
const LIBRARY_COMMANDS: ReadonlySet<string> = new Set<LibraryCommand>(['RssSync', 'RefreshMovie', 'RefreshCollections']);

function isLibraryCommand(name: unknown): name is LibraryCommand {
  return typeof name === 'string' && LIBRARY_COMMANDS.has(name);
}

async function postHandler(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    // JSON only, as for restart and shut down: a form on a sibling subdomain (the
    // same site, for the session cookie) can post text/plain, but not JSON,
    // without the browser asking first, and this takes no password.
    const body: unknown = await readBoundedJson(request, 1024);
    const name = body && typeof body === 'object' ? (body as { name?: unknown }).name : undefined;
    if (!isLibraryCommand(name)) {
      return NextResponse.json({ error: 'Unknown command' }, { status: 400 });
    }
    // The command runs on the instance named, never the default one.
    const target = await resolveActivityArrTarget(auth.user, 'radarr', request.nextUrl.searchParams.get('instanceId'));
    if (!target.ok) return target.response;

    const result = await (target.target.client as RadarrClient).runLibraryCommand(name);
    logger.info('Radarr library command', {
      userId: auth.user.id,
      username: auth.user.username,
      instanceId: target.target.instanceId,
      command: name,
      commandId: result.id,
    }, { scope: 'radarr' });
    // The page needs only the id, to follow the command.
    return NextResponse.json({ id: result.id, name: result.name, status: result.status });
  } catch (error) {
    const refused = boundedBodyErrorResponse(error);
    if (refused) return refused;
    return upstreamErrorResponse(error, 'Failed to execute command');
  }
}

export const POST = withApiLogging(postHandler, 'api/radarr/library-command');
