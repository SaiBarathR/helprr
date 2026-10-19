import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUserAllCapabilities } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { serializeManualDownload } from '@/lib/manual-downloads/serialize';
import { SENDING_STATUSES } from '@/lib/manual-downloads/preflight';

type Context = { params: Promise<{ id: string }> };

/** One manual download with its history of transitions. */
async function getHandler(_request: Request, { params }: Context) {
  const auth = await requireUserAllCapabilities(['torrents.view', 'activity.view']);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const download = await prisma.manualDownload.findUnique({
    where: { id },
    include: {
      events: { orderBy: { at: 'asc' }, select: { at: true, status: true, message: true } },
      files: { orderBy: { fileIndex: 'asc' } },
    },
  });
  if (!download) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ download: serializeManualDownload(download) });
}

/** Unlink: forget Helprr's record. Arr, the download client and the library are not touched. */
async function deleteHandler(_request: Request, { params }: Context) {
  const auth = await requireUserAllCapabilities(['activity.manage']);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  // Not while it is being sent: the sender still owns the record and its request key.
  const removed = await prisma.manualDownload.deleteMany({ where: { id, status: { notIn: [...SENDING_STATUSES] } } });
  if (removed.count === 0) {
    const exists = await prisma.manualDownload.findUnique({ where: { id }, select: { id: true } });
    return exists
      ? NextResponse.json({ error: 'This download is still being sent. Try again once it has been.' }, { status: 409 })
      : NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export const GET = withApiLogging(getHandler, 'api/manual-downloads/[id]');
export const DELETE = withApiLogging(deleteHandler, 'api/manual-downloads/[id]');
