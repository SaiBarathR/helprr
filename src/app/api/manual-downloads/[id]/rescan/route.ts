import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUserAllCapabilities } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { resolveConnection } from '@/lib/arr-instances';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { arrClientFor } from '@/lib/manual-downloads/preflight';
import { settleDownloaded } from '@/lib/manual-downloads/fallback';
import { serializeManualDownload } from '@/lib/manual-downloads/serialize';

/**
 * Ask Arr again what a finished fallback download's files are (after fixing a
 * path mapping, or adding what Arr needed): imports them when Arr is now sure
 * of every file, otherwise leaves them for the user to map.
 */
async function postHandler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUserAllCapabilities(['activity.manage']);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const download = await prisma.manualDownload.findUnique({ where: { id } });
  if (!download) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (download.mode !== 'QBIT_REVIEWED' || !download.instanceId || !['NEEDS_MAPPING', 'BLOCKED'].includes(download.status)) {
    return NextResponse.json({ error: 'There is nothing to scan again.' }, { status: 409 });
  }

  try {
    const [torrent] = await (await getQBittorrentClient()).getTorrents(undefined, undefined, undefined, undefined, download.infoHash.toLowerCase());
    if (!torrent) return NextResponse.json({ error: 'The torrent is no longer in qBittorrent.' }, { status: 409 });
    if (torrent.progress < 1) return NextResponse.json({ error: 'The chosen files have not finished downloading.' }, { status: 409 });
    const service = download.service === 'RADARR' ? 'RADARR' : 'SONARR';
    const client = arrClientFor(service, await resolveConnection(service, download.instanceId));
    if (!(await settleDownloaded(download, client, torrent.save_path))) {
      return NextResponse.json({ error: 'A scan or import is already running.' }, { status: 409 });
    }
    const updated = await prisma.manualDownload.findUniqueOrThrow({
      where: { id },
      include: { events: { orderBy: { at: 'asc' }, select: { at: true, status: true, message: true } }, files: { orderBy: { fileIndex: 'asc' } } },
    });
    return NextResponse.json({ download: serializeManualDownload(updated) });
  } catch (error) {
    console.error('[manual-downloads] rescan failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'The scan could not run.' }, { status: 502 });
  }
}

export const POST = withApiLogging(postHandler, 'api/manual-downloads/[id]/rescan');
