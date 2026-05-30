import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { ensureNotificationPreferences } from '@/lib/notification-events';
import { withApiLogging } from '@/lib/api-logger';

async function postHandler(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const { endpoint, keys, deviceName } = body;

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return NextResponse.json({ error: 'Missing subscription data' }, { status: 400 });
    }

    // Own the subscription so per-user notification gating/targeting works. The
    // endpoint stays globally unique, so re-subscribing the same device from a
    // different account reassigns ownership (the upsert sets userId on update too).
    const subscription = await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: {
        userId: auth.user.id,
        p256dh: keys.p256dh,
        auth: keys.auth,
        deviceName,
        revokedAt: null,
        consecutiveFailures: 0,
      },
      create: { userId: auth.user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, deviceName },
    });

    await ensureNotificationPreferences(subscription.id);

    return NextResponse.json(subscription);
  } catch (error) {
    console.error('Failed to save push subscription:', error);
    return NextResponse.json({ error: 'Failed to save push subscription' }, { status: 500 });
  }
}

async function deleteHandler(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const { endpoint } = body;

    if (endpoint) {
      // Members can only drop their own device; admins can drop any.
      const where =
        auth.user.role === 'admin' ? { endpoint } : { endpoint, userId: auth.user.id };
      await prisma.pushSubscription.deleteMany({ where }).catch(() => {});
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: true });
  }
}

export const POST = withApiLogging(postHandler, 'api/push/subscribe');
export const DELETE = withApiLogging(deleteHandler, 'api/push/subscribe');
