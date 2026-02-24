import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { EVENT_TYPES, ensureNotificationPreferences } from '@/lib/notification-events';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = request.nextUrl;
    const subscriptionId = searchParams.get('subscriptionId');
    const endpoint = searchParams.get('endpoint');

    if (!subscriptionId && !endpoint) {
      return NextResponse.json({ error: 'subscriptionId or endpoint is required' }, { status: 400 });
    }

    let resolvedSubscriptionId: string | null = null;
    if (subscriptionId) {
      const sub = await prisma.pushSubscription.findUnique({ where: { id: subscriptionId } });
      if (!sub) {
        return NextResponse.json({ error: 'subscription not found' }, { status: 404 });
      }
      resolvedSubscriptionId = sub.id;
    } else if (endpoint) {
      const sub = await prisma.pushSubscription.findUnique({ where: { endpoint } });
      if (sub) {
        resolvedSubscriptionId = sub.id;
      }
    }

    if (!resolvedSubscriptionId) {
      return NextResponse.json([]);
    }

    await ensureNotificationPreferences(resolvedSubscriptionId);

    const where = { subscriptionId: resolvedSubscriptionId };

    const preferences = await prisma.notificationPreference.findMany({
      where,
      include: { subscription: true },
    });

    return NextResponse.json(preferences);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

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

    const normalizeOptionalString = (value: unknown, fieldName: string): { value?: string | null; error?: NextResponse } => {
      if (value == null) return { value: null };
      if (typeof value !== 'string') {
        return {
          error: NextResponse.json({ error: `${fieldName} must be a string` }, { status: 400 }),
        };
      }
      const trimmed = value.trim();
      return { value: trimmed ? trimmed : null };
    };

    const normalizedTag = normalizeOptionalString(tagFilter, 'tagFilter');
    if (normalizedTag.error) return normalizedTag.error;

    const normalizedQuality = normalizeOptionalString(qualityFilter, 'qualityFilter');
    if (normalizedQuality.error) return normalizedQuality.error;

    const subscription = await prisma.pushSubscription.findUnique({
      where: { id: subscriptionId },
      select: { id: true },
    });
    if (!subscription) {
      return NextResponse.json({ error: 'Subscription not found' }, { status: 404 });
    }

    await ensureNotificationPreferences(subscriptionId);

    const preference = await prisma.notificationPreference.upsert({
      where: { subscriptionId_eventType: { subscriptionId, eventType } },
      update: { enabled, tagFilter: normalizedTag.value, qualityFilter: normalizedQuality.value },
      create: { subscriptionId, eventType, enabled, tagFilter: normalizedTag.value, qualityFilter: normalizedQuality.value },
    });

    return NextResponse.json(preference);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed' }, { status: 500 });
  }
}
