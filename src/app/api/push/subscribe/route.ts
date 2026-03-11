import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { ensureNotificationPreferences } from '@/lib/notification-events';

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid subscription data' }, { status: 400 });
    }

    const { endpoint, keys, deviceName } = body;

    if (
      typeof endpoint !== 'string' ||
      endpoint.trim().length === 0 ||
      typeof keys?.p256dh !== 'string' ||
      typeof keys.auth !== 'string' ||
      (deviceName !== undefined && deviceName !== null && typeof deviceName !== 'string')
    ) {
      return NextResponse.json({ error: 'Invalid subscription data' }, { status: 400 });
    }

    const normalizedEndpoint = endpoint.trim();
    const normalizedDeviceName = typeof deviceName === 'string' ? deviceName.trim() || null : null;

    const subscription = await prisma.pushSubscription.upsert({
      where: { endpoint: normalizedEndpoint },
      update: { p256dh: keys.p256dh, auth: keys.auth, deviceName: normalizedDeviceName },
      create: { endpoint: normalizedEndpoint, p256dh: keys.p256dh, auth: keys.auth, deviceName: normalizedDeviceName },
    });

    await ensureNotificationPreferences(subscription.id);

    return NextResponse.json(subscription);
  } catch (error) {
    console.error('Failed to save push subscription:', error);
    return NextResponse.json({ error: 'Failed to save push subscription' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const body = await request.json();
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: true });
    }

    const { endpoint } = body;

    if (typeof endpoint === 'string' && endpoint.trim().length > 0) {
      await prisma.pushSubscription.delete({ where: { endpoint: endpoint.trim() } }).catch(() => {});
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: true });
  }
}
