import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUserAllCapabilities } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { serializeManualDownload } from '@/lib/manual-downloads/serialize';

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
  const removed = await prisma.manualDownload.deleteMany({ where: { id } });
  if (removed.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export const GET = withApiLogging(getHandler, 'api/manual-downloads/[id]');
export const DELETE = withApiLogging(deleteHandler, 'api/manual-downloads/[id]');
