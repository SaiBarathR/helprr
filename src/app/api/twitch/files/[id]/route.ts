import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { FILE_SELECT, fileTimeline, serializeFile, typicalSavingPercent } from '@/lib/twitch/files';
import { enqueueFileDelete, fileCleanupStatus, loadPlayedDates } from '@/lib/twitch/retention';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function getHandler(_request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.view');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const file = await prisma.twitchMediaFile.findUnique({
    where: { id },
    select: {
      ...FILE_SELECT,
      video: {
        select: {
          ...FILE_SELECT.video.select,
          category: true,
          streamerId: true,
          durationSeconds: true,
        },
      },
    },
  });
  if (!file) return NextResponse.json({ error: 'File not found' }, { status: 404 });

  const played = await loadPlayedDates(auth.user, file.jellyfinItemId ? [file.jellyfinItemId] : []);
  const watchedAt = file.jellyfinItemId ? played.get(file.jellyfinItemId) : undefined;
  const [cleanup, timeline, typicalSaving] = await Promise.all([
    fileCleanupStatus(file, watchedAt),
    fileTimeline(file.id, file.videoId),
    typicalSavingPercent(),
  ]);
  return NextResponse.json({ ...serializeFile(file, watchedAt), cleanup, timeline, typicalSaving });
}

async function patchHandler(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.manage');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as { keepForever?: unknown } | null;
  if (typeof body?.keepForever !== 'boolean') return NextResponse.json({ error: 'keepForever is required' }, { status: 400 });

  const { id } = await params;
  const { count } = await prisma.twitchMediaFile.updateMany({ where: { id }, data: { keepForever: body.keepForever } });
  if (count === 0) return NextResponse.json({ error: 'File not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

async function deleteHandler(_request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.manage');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!(await enqueueFileDelete(id, auth.user))) return NextResponse.json({ error: 'File not found' }, { status: 404 });
  return NextResponse.json({ ok: true }, { status: 202 });
}

export const GET = withApiLogging(getHandler, 'api/twitch/files/[id]');
export const PATCH = withApiLogging(patchHandler, 'api/twitch/files/[id]');
export const DELETE = withApiLogging(deleteHandler, 'api/twitch/files/[id]');
