import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUserAllCapabilities } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { resolveConnection } from '@/lib/arr-instances';
import { arrClientFor } from '@/lib/manual-downloads/preflight';
import { FallbackImportError, importFallback, previewFallback } from '@/lib/manual-downloads/fallback';
import { ManualDownloadRequestError, readFileDecisions } from '@/lib/manual-downloads/request';
import { serializeManualDownload } from '@/lib/manual-downloads/serialize';

/**
 * Import a fallback download's files as the user decided (each a chosen,
 * downloaded file; episodes checked against the series). With ?preview=1,
 * Arr's verdict on those decisions without importing anything.
 */
async function postHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUserAllCapabilities(['activity.manage']);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  let decisions;
  try {
    decisions = readFileDecisions(await request.json());
  } catch (error) {
    return NextResponse.json({ error: error instanceof ManualDownloadRequestError ? error.message : 'Invalid request.' }, { status: 400 });
  }
  const download = await prisma.manualDownload.findUnique({ where: { id }, include: { files: true } });
  if (!download) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (download.mode !== 'QBIT_REVIEWED' || !download.instanceId || !download.arrItemId) {
    return NextResponse.json({ error: 'This download is not imported by Helprr.' }, { status: 409 });
  }

  try {
    const service = download.service === 'RADARR' ? 'RADARR' : 'SONARR';
    const client = arrClientFor(service, await resolveConnection(service, download.instanceId));
    if (new URL(request.url).searchParams.get('preview') === '1') {
      return NextResponse.json({ files: await previewFallback(download, client, decisions) });
    }
    await importFallback(download, client, decisions, { id: auth.user.id, username: auth.user.username });
    const updated = await prisma.manualDownload.findUniqueOrThrow({
      where: { id },
      include: { events: { orderBy: { at: 'asc' }, select: { at: true, status: true, message: true } }, files: { orderBy: { fileIndex: 'asc' } } },
    });
    return NextResponse.json({ download: serializeManualDownload(updated) });
  } catch (error) {
    if (error instanceof FallbackImportError) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error('[manual-downloads] import failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'The import could not be started.' }, { status: 502 });
  }
}

export const POST = withApiLogging(postHandler, 'api/manual-downloads/[id]/import');
