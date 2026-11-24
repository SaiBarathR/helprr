import { NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { readSharedTorrents } from '@/lib/share/shared-torrents';

/** The .torrent files this user last shared into the app (see shared-torrents), for the Add page to prefill. */
async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('torrents.add');
  if (!auth.ok) return auth.response;
  const files = await readSharedTorrents(auth.user.id);
  if (!files || files.length === 0) {
    return NextResponse.json({ error: 'The shared files are gone (they are kept for 15 minutes): share them again' }, { status: 404 });
  }
  return NextResponse.json({ files });
}

export const GET = withApiLogging(getHandler, 'api/share/torrents', { logBodies: false });
