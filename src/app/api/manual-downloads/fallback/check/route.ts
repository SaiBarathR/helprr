import { NextResponse } from 'next/server';
import { requireUserAllCapabilities } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { withApiLogging } from '@/lib/api-logger';
import { checkFallback } from '@/lib/manual-downloads/fallback';
import { ManualDownloadRequestError, readFallbackRequest, SERVICE_ADD_CAPABILITY } from '@/lib/manual-downloads/request';

/**
 * Check the advanced fallback before the torrent starts: the torrent and the
 * files chosen, the title and add options, and that Arr can see qBittorrent's
 * download folder. Changes nothing.
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
  return NextResponse.json(await checkFallback(parsed.input));
}

export const POST = withApiLogging(postHandler, 'api/manual-downloads/fallback/check');
