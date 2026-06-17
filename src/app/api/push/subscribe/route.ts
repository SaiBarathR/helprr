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
    const { endpoint, keys, deviceName, oldEndpoint } = body;

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return NextResponse.json({ error: 'Missing subscription data' }, { status: 400 });
    }

    // Endpoint rotation (the SW's pushsubscriptionchange handler — iOS rotates the
    // push endpoint periodically). Migrate the existing device row *in place* so its
    // per-event NotificationPreference rows (linked by subscription id) survive and
    // we don't accumulate a duplicate "device". Same ownership gate as DELETE.
    if (oldEndpoint && oldEndpoint !== endpoint) {
      const existing = await prisma.pushSubscription.findUnique({ where: { endpoint: oldEndpoint } });
      if (existing && (auth.user.role === 'admin' || existing.userId === auth.user.id)) {
        // Drop any pre-existing row for the new endpoint so the unique constraint
        // doesn't block the rename; the migrated row keeps the curated preferences.
        await prisma.pushSubscription
          .deleteMany({ where: { endpoint, NOT: { id: existing.id } } })
          .catch(() => {});
        const migrated = await prisma.pushSubscription.update({
          where: { id: existing.id },
          data: {
            userId: auth.user.id,
            endpoint,
            p256dh: keys.p256dh,
            auth: keys.auth,
            // The SW doesn't know the device name — keep the existing one.
            ...(deviceName ? { deviceName } : {}),
            revokedAt: null,
            consecutiveFailures: 0,
          },
        });
        await ensureNotificationPreferences(migrated.id);
        return NextResponse.json(migrated);
      }
      // No matching old row (already pruned) — fall through to a normal upsert.
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
