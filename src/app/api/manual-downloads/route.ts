import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUserAllCapabilities } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { withApiLogging } from '@/lib/api-logger';
import { ManualDownloadRequestError, readManualDownloadRequest, SERVICE_ADD_CAPABILITY, SERVICE_MONITOR_CAPABILITY } from '@/lib/manual-downloads/request';
import { ManualDownloadRefusedError, sendManualDownload } from '@/lib/manual-downloads/send';
import { serializeManualDownload } from '@/lib/manual-downloads/serialize';

const FILTERS: Record<string, Prisma.ManualDownloadWhereInput> = {
  open: { status: { notIn: ['IMPORTED', 'FAILED', 'CANCELLED', 'BLOCKED', 'NEEDS_MAPPING'] } },
  attention: { status: { in: ['BLOCKED', 'NEEDS_MAPPING', 'FAILED'] } },
  history: { status: { in: ['IMPORTED', 'FAILED', 'CANCELLED'] } },
};

/** The latest manual downloads, newest first. */
async function getHandler(request: NextRequest) {
  const auth = await requireUserAllCapabilities(['torrents.view', 'activity.view']);
  if (!auth.ok) return auth.response;
  const filter = request.nextUrl.searchParams.get('filter') ?? 'all';
  const where = FILTERS[filter] ?? {};
  const downloads = await prisma.manualDownload.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 100 });
  return NextResponse.json({ downloads: downloads.map((download) => serializeManualDownload(download)) });
}

/**
 * Send a magnet or .torrent to Sonarr/Radarr for one title. Runs the preflight
 * again, then adds the title (searches off) when needed, pushes the release and
 * proves the grab. Answers 201 with the workflow (QUEUED, or FAILED with the
 * reason), 409 when the preflight refuses it (nothing created).
 */
async function postHandler(request: Request) {
  const auth = await requireUserAllCapabilities(['torrents.add', 'activity.manage']);
  if (!auth.ok) return auth.response;

  let parsed;
  try {
    parsed = await readManualDownloadRequest(await request.formData());
  } catch (error) {
    if (error instanceof ManualDownloadRequestError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }
  if (!can(auth.user, SERVICE_ADD_CAPABILITY[parsed.input.service])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (parsed.input.monitorTarget && !can(auth.user, SERVICE_MONITOR_CAPABILITY[parsed.input.service])) {
    return NextResponse.json({ error: 'Changing monitoring is not allowed for this account.' }, { status: 403 });
  }
  if (!parsed.clientRequestId) return NextResponse.json({ error: 'Missing request id.' }, { status: 400 });

  try {
    const download = await sendManualDownload(parsed.input, parsed.clientRequestId, { id: auth.user.id, username: auth.user.username });
    return NextResponse.json({ download: serializeManualDownload(download) }, { status: 201 });
  } catch (error) {
    if (error instanceof ManualDownloadRefusedError) {
      return NextResponse.json({ error: error.message, ...error.result }, { status: 409 });
    }
    console.error('[manual-downloads] send failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'The download could not be sent.' }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/manual-downloads');
// The request can carry a magnet; keep request bodies out of the logs.
export const POST = withApiLogging(postHandler, 'api/manual-downloads', { logBodies: false });
