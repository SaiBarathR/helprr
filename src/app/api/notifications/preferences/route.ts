import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { ownerScope } from '@/lib/user-dto';
import { EVENT_TYPES, ensureNotificationPreferences } from '@/lib/notification-events';
import { withApiLogging } from '@/lib/api-logger';

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = request.nextUrl;
    const subscriptionId = searchParams.get('subscriptionId');
    const endpoint = searchParams.get('endpoint');

    if (!subscriptionId && !endpoint) {
      return NextResponse.json({ error: 'subscriptionId or endpoint is required' }, { status: 400 });
    }

    let resolvedSubscriptionId: string | null = null;
    if (subscriptionId) {
      // Scope to the caller's own devices so a member can't read another's prefs.
      const sub = await prisma.pushSubscription.findFirst({
        where: { id: subscriptionId, ...ownerScope(auth.user) },
      });
      if (!sub) {
        return NextResponse.json({ error: 'subscription not found' }, { status: 404 });
      }
      resolvedSubscriptionId = sub.id;
    } else if (endpoint) {
      const sub = await prisma.pushSubscription.findFirst({ where: { endpoint, ...ownerScope(auth.user) } });
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

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

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

    const subscription = await prisma.pushSubscription.findFirst({
      where: { id: subscriptionId, ...ownerScope(auth.user) },
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

export const GET = withApiLogging(getHandler, 'api/notifications/preferences');
export const POST = withApiLogging(postHandler, 'api/notifications/preferences');
