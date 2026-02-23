import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { ensureNotificationPreferences } from '@/lib/notification-events';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { endpoint, keys, deviceName } = body;

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return NextResponse.json({ error: 'Missing subscription data' }, { status: 400 });
    }

    const subscription = await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: { p256dh: keys.p256dh, auth: keys.auth, deviceName },
      create: { endpoint, p256dh: keys.p256dh, auth: keys.auth, deviceName },
    });

    await ensureNotificationPreferences(subscription.id);

    return NextResponse.json(subscription);
  } catch (error) {
    console.error('Failed to save push subscription:', error);
    return NextResponse.json({ error: 'Failed to save push subscription' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { endpoint } = body;

    if (endpoint) {
      await prisma.pushSubscription.delete({ where: { endpoint } }).catch(() => {});
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: true });
  }
}
