import { NextResponse } from 'next/server';
import { requireUserAllCapabilities } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { withApiLogging } from '@/lib/api-logger';
import { FallbackRefusedError, startFallbackDownload } from '@/lib/manual-downloads/fallback';
import { ManualDownloadRequestError, readFallbackRequest, SERVICE_ADD_CAPABILITY } from '@/lib/manual-downloads/request';
import { serializeManualDownload } from '@/lib/manual-downloads/serialize';

/**
 * Start the advanced fallback for a torrent already in qBittorrent (stopped):
 * record the exact files chosen, add the title (searches off) when needed, and
 * let qBittorrent download only those files. 201 with the workflow, 409 when
 * the check refuses it (nothing created).
 */
async function postHandler(request: Request) {
  const auth = await requireUserAllCapabilities(['torrents.add', 'torrents.manage', 'activity.manage']);
  if (!auth.ok) return auth.response;

  let parsed;
  try {
    parsed = readFallbackRequest(await request.json());
  } catch (error) {
    return NextResponse.json({ error: error instanceof ManualDownloadRequestError ? error.message : 'Invalid request.' }, { status: 400 });
  }
  if (!can(auth.user, SERVICE_ADD_CAPABILITY[parsed.input.service])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!parsed.clientRequestId) return NextResponse.json({ error: 'Missing request id.' }, { status: 400 });

  try {
    const download = await startFallbackDownload(parsed.input, parsed.clientRequestId, { id: auth.user.id, username: auth.user.username });
    return NextResponse.json({ download: serializeManualDownload(download) }, { status: 201 });
  } catch (error) {
    if (error instanceof FallbackRefusedError) return NextResponse.json({ error: error.message, ...error.result }, { status: 409 });
    console.error('[manual-downloads] fallback start failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'The download could not be started.' }, { status: 500 });
  }
}

export const POST = withApiLogging(postHandler, 'api/manual-downloads/fallback');
