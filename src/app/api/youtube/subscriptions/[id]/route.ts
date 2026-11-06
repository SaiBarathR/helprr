import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { creatorFollowersLeft } from '@/lib/archive/followers';
import { prisma } from '@/lib/db';
import { can } from '@/lib/permissions';
import { YOUTUBE } from '@/lib/youtube/platform';

type RouteContext = { params: Promise<{ id: string }> };

async function patchHandler(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.view');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as { notifyNewVods?: unknown } | null;
  if (typeof body?.notifyNewVods !== 'boolean') {
    return NextResponse.json({ error: 'notifyNewVods must be a boolean' }, { status: 400 });
  }
  const { id } = await params;
  const { count } = await prisma.creatorSubscription.updateMany({
    where: { id, userId: auth.user.id, creator: { platform: YOUTUBE } },
    data: { notifyNewVods: body.notifyNewVods },
  });
  if (count === 0) return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

async function deleteHandler(_request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const auth = await requireUserCapability('youtube.view');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const where = { id, userId: auth.user.id, creator: { platform: YOUTUBE } };
  const subscription = await prisma.creatorSubscription.findFirst({ where, select: { creatorId: true } });
  if (!subscription) return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
  const { count } = await prisma.creatorSubscription.deleteMany({ where });
  if (count === 0) return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
  return NextResponse.json({ ok: true, ...await creatorFollowersLeft(YOUTUBE, subscription.creatorId, can(auth.user, 'youtube.manage')) });
}

export const PATCH = withApiLogging(patchHandler, 'api/youtube/subscriptions/[id]');
export const DELETE = withApiLogging(deleteHandler, 'api/youtube/subscriptions/[id]');
