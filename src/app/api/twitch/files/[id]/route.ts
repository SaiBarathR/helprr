import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { fileSelect, fileTimeline, serializeFile, setKeepForever, typicalSavingPercent } from '@/lib/archive/files';
import { enqueueFileDelete, fileCleanupStatus, loadPlayedDates } from '@/lib/archive/retention';
import { TWITCH } from '@/lib/twitch/platform';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function getHandler(_request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.view');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const select = fileSelect(TWITCH);
  const file = await prisma.archiveMediaFile.findUnique({
    where: { id, platform: TWITCH },
    select: {
      ...select,
      video: {
        select: {
          ...select.video.select,
          category: true,
          creatorId: true,
          durationSeconds: true,
        },
      },
    },
  });
  if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });

  const played = await loadPlayedDates(auth.user, file.jellyfinItemId ? [file.jellyfinItemId] : []);
  const watchedAt = file.jellyfinItemId ? played.get(file.jellyfinItemId) : undefined;
  const [cleanup, timeline, typicalSaving] = await Promise.all([
    fileCleanupStatus(file, watchedAt, TWITCH),
    fileTimeline(file.id, file.videoId, TWITCH),
    typicalSavingPercent(TWITCH),
  ]);
  return NextResponse.json({ ...serializeFile(file, watchedAt), cleanup, timeline, typicalSaving });
}

async function patchHandler(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.manage');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as { keepForever?: unknown } | null;
  if (typeof body?.keepForever !== 'boolean') return NextResponse.json({ error: 'keepForever is required' }, { status: 400 });

  const { id } = await params;
  const found = await setKeepForever(id, body.keepForever, TWITCH);
  if (!found) return NextResponse.json({ error: 'File not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

async function deleteHandler(_request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.manage');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!(await enqueueFileDelete(id, auth.user, TWITCH))) return NextResponse.json({ error: 'File not found' }, { status: 404 });
  return NextResponse.json({ ok: true }, { status: 202 });
}

export const GET = withApiLogging(getHandler, 'api/twitch/files/[id]');
export const PATCH = withApiLogging(patchHandler, 'api/twitch/files/[id]');
export const DELETE = withApiLogging(deleteHandler, 'api/twitch/files/[id]');
