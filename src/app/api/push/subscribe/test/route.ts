import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { sendPushNotification, initVapid } from '@/lib/notification-service';

export async function POST() {
    try {
        initVapid();

        const subscriptions = await prisma.pushSubscription.findMany();

        if (subscriptions.length === 0) {
            return NextResponse.json(
                { error: 'No push subscriptions found. Please enable notifications first.' },
                { status: 404 }
            );
        }

        let sent = 0;
        const errors: string[] = [];

        for (const sub of subscriptions) {
            const success = await sendPushNotification(
                { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
                {
                    title: 'Helprr Test Notification',
                    body: 'Push notifications are working correctly! 🎉',
                    tag: 'test-notification',
                    url: '/notifications/preferences',
                }
            );
            if (success) {
                sent++;
            } else {
                errors.push(`Failed to send to subscription ${sub.id}`);
            }
        }

        if (sent === 0) {
            return NextResponse.json(
                { error: 'Failed to send to any subscription. Check VAPID configuration.', details: errors },
                { status: 500 }
            );
        }

        return NextResponse.json({ success: true, sent, total: subscriptions.length });
    } catch (error) {
        console.error('[Test Notification] Error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to send test notification' },
            { status: 500 }
        );
    }
}
