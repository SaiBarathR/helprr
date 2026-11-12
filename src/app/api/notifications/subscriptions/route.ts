import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUserCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';
import { toNotificationDeviceSummary } from '@/lib/notification-subscriptions';

/**
 * This page is your own devices, admins included. With everyone's in it (by
 * device name only), an admin's "Revoke all" turned off every person's pushes
 * and deleted their notification choices.
 */
function ownDevices(user: { id: string }): { userId: string } {
  return { userId: user.id };
}

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('settings.notifications');
  if (!auth.ok) return auth.response;

  try {
    const rows = await prisma.pushSubscription.findMany({
      where: { revokedAt: null, ...ownDevices(auth.user) },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        endpoint: true,
        deviceName: true,
        consecutiveFailures: true,
        lastFailedAt: true,
        lastSucceededAt: true,
        createdAt: true,
      },
    });
    return NextResponse.json(rows.map(toNotificationDeviceSummary));
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed');
  }
}

async function deleteHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUserCapability('settings.notifications');
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      id?: unknown;
      all?: unknown;
    };
    const revokedAt = new Date();

    if (body.all === true) {
      const targets = await prisma.pushSubscription.findMany({
        where: { revokedAt: null, ...ownDevices(auth.user) },
        select: { id: true },
      });
      const ids = targets.map((t) => t.id);
      if (ids.length === 0) return NextResponse.json({ revoked: 0 });
      await prisma.$transaction([
        prisma.notificationPreference.deleteMany({ where: { subscriptionId: { in: ids } } }),
        prisma.pushSubscription.updateMany({
          where: { id: { in: ids } },
          data: { revokedAt },
        }),
      ]);
      return NextResponse.json({ revoked: ids.length });
    }

    if (typeof body.id !== 'string' || !body.id.trim()) {
      return NextResponse.json({ error: 'id or all=true required' }, { status: 400 });
    }

    const existing = await prisma.pushSubscription.findFirst({
      where: { id: body.id, ...ownDevices(auth.user) },
      select: { id: true, revokedAt: true },
    });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (existing.revokedAt) return NextResponse.json({ revoked: 0 });

    await prisma.$transaction([
      prisma.notificationPreference.deleteMany({ where: { subscriptionId: existing.id } }),
      prisma.pushSubscription.update({
        where: { id: existing.id },
        data: { revokedAt },
      }),
    ]);
    return NextResponse.json({ revoked: 1 });
  } catch (error) {
    return upstreamErrorResponse(error, 'Failed');
  }
}

export const GET = withApiLogging(getHandler, 'api/notifications/subscriptions');
export const DELETE = withApiLogging(deleteHandler, 'api/notifications/subscriptions');
