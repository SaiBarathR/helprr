import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { EVENT_TYPES, ensureNotificationPreferences } from '@/lib/notification-events';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const subscriptionId = searchParams.get('subscriptionId');
    const endpoint = searchParams.get('endpoint');

    let resolvedSubscriptionId: string | null = null;
    if (subscriptionId) {
      resolvedSubscriptionId = subscriptionId;
    } else if (endpoint) {
      const sub = await prisma.pushSubscription.findUnique({ where: { endpoint } });
      if (sub) {
        resolvedSubscriptionId = sub.id;
      } else {
        return NextResponse.json([]);
      }
    }

    if (!resolvedSubscriptionId && !endpoint) {
      return NextResponse.json({ error: 'subscriptionId or endpoint is required' }, { status: 400 });
    }

    if (resolvedSubscriptionId) {
      await ensureNotificationPreferences(resolvedSubscriptionId);
    }

    const where = resolvedSubscriptionId
      ? { subscriptionId: resolvedSubscriptionId }
      : { subscription: { endpoint: endpoint as string } };

    const preferences = await prisma.notificationPreference.findMany({
      where,
      include: { subscription: true },
    });

    return NextResponse.json(preferences);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { subscriptionId, eventType, enabled, tagFilter, qualityFilter } = body;
    if (typeof subscriptionId !== 'string' || !subscriptionId.trim()) {
      return NextResponse.json({ error: 'subscriptionId is required' }, { status: 400 });
    }
    if (
      typeof eventType !== 'string'
      || !eventType.trim()
      || !EVENT_TYPES.includes(eventType as (typeof EVENT_TYPES)[number])
    ) {
      return NextResponse.json({ error: 'Invalid event type' }, { status: 400 });
    }
    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
    }

    await ensureNotificationPreferences(subscriptionId);

    const preference = await prisma.notificationPreference.upsert({
      where: { subscriptionId_eventType: { subscriptionId, eventType } },
      update: { enabled, tagFilter, qualityFilter },
      create: { subscriptionId, eventType, enabled, tagFilter, qualityFilter },
    });

    return NextResponse.json(preference);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
