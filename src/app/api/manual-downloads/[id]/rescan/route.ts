import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUserAllCapabilities } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { resolveConnection } from '@/lib/arr-instances';
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
    const service = download.service === 'RADARR' ? 'RADARR' : 'SONARR';
    const client = arrClientFor(service, await resolveConnection(service, download.instanceId));
    // Checks the chosen files in qBittorrent first, and records what it finds.
    if (!(await settleDownloaded(download, client))) {
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
