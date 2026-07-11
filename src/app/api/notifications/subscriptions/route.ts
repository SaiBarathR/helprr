import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUserCapability } from '@/lib/auth';
import { ownerScope } from '@/lib/user-dto';
import { withApiLogging } from '@/lib/api-logger';
import { upstreamErrorResponse } from '@/lib/api-error';

async function getHandler(): Promise<NextResponse> {
  const auth = await requireUserCapability('settings.notifications');
  if (!auth.ok) return auth.response;

  try {
    const rows = await prisma.pushSubscription.findMany({
      where: { revokedAt: null, ...ownerScope(auth.user) },
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
    return NextResponse.json(rows);
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
        where: { revokedAt: null, ...ownerScope(auth.user) },
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
      where: { id: body.id, ...ownerScope(auth.user) },
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
