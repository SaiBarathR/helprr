import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';
import { YOUTUBE } from '@/lib/youtube/platform';

type RouteContext = { params: Promise<{ id: string }> };

async function patchHandler(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.view');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as { notifyNewVideos?: unknown } | null;
  if (typeof body?.notifyNewVideos !== 'boolean') {
    return NextResponse.json({ error: 'notifyNewVideos must be a boolean' }, { status: 400 });
  }
  const { id } = await params;
  const { count } = await prisma.creatorPlaylistSubscription.updateMany({
    where: { id, userId: auth.user.id, playlist: { platform: YOUTUBE } },
    data: { notifyNewVideos: body.notifyNewVideos },
  });
  if (count === 0) return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

async function deleteHandler(_request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.view');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const { count } = await prisma.creatorPlaylistSubscription.deleteMany({
    where: { id, userId: auth.user.id, playlist: { platform: YOUTUBE } },
  });
  if (count === 0) return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export const PATCH = withApiLogging(patchHandler, 'api/youtube/playlist-subscriptions/[id]');
export const DELETE = withApiLogging(deleteHandler, 'api/youtube/playlist-subscriptions/[id]');
