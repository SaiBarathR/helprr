import { NextRequest, NextResponse } from 'next/server';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { prisma } from '@/lib/db';

type RouteContext = { params: Promise<{ id: string }> };

async function patchHandler(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.view');
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null) as { notifyNewVods?: unknown } | null;
  if (typeof body?.notifyNewVods !== 'boolean') {
    return NextResponse.json({ error: 'notifyNewVods must be a boolean' }, { status: 400 });
  }
  const { id } = await params;
  const { count } = await prisma.twitchSubscription.updateMany({
    where: { id, userId: auth.user.id },
    data: { notifyNewVods: body.notifyNewVods },
  });
  if (count === 0) return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

async function deleteHandler(_request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const auth = await requireUserCapability('twitch.view');
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const { count } = await prisma.twitchSubscription.deleteMany({ where: { id, userId: auth.user.id } });
  if (count === 0) return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export const PATCH = withApiLogging(patchHandler, 'api/twitch/subscriptions/[id]');
export const DELETE = withApiLogging(deleteHandler, 'api/twitch/subscriptions/[id]');
