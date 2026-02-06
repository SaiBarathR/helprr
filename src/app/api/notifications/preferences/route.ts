import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const subscriptionId = searchParams.get('subscriptionId');
    const endpoint = searchParams.get('endpoint');

    let where = {};
    if (subscriptionId) {
      where = { subscriptionId };
    } else if (endpoint) {
      const sub = await prisma.pushSubscription.findUnique({ where: { endpoint } });
      if (sub) {
        where = { subscriptionId: sub.id };
      } else {
        return NextResponse.json([]);
      }
    }

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
