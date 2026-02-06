import webpush from 'web-push';
import { prisma } from '@/lib/db';

let vapidInitialized = false;

export function initVapid() {
  if (vapidInitialized) return;
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;

  if (!subject || !publicKey || !privateKey) {
    console.warn('VAPID keys not configured — push notifications disabled');
    return;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidInitialized = true;
}

export async function sendPushNotification(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: { title: string; body: string; tag?: string; url?: string }
): Promise<boolean> {
  initVapid();
  if (!vapidInitialized) return false;

  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload)
    );
    return true;
  } catch (error: unknown) {
    const statusCode = (error as { statusCode?: number })?.statusCode;
    if (statusCode === 410 || statusCode === 404) {
      await prisma.pushSubscription.delete({
        where: { endpoint: subscription.endpoint },
      }).catch(() => { });
    }
    return false;
  }
}

export async function notifyEvent(event: {
  eventType: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  url?: string;
}): Promise<number> {
  const subscriptions = await prisma.pushSubscription.findMany({
    include: { preferences: true },
  });

  let sent = 0;

  for (const sub of subscriptions) {
    const pref = sub.preferences.find((p) => p.eventType === event.eventType);
    // If no preference exists for this event type, default to sending (enabled)
    if (pref && !pref.enabled) continue;

    const success = await sendPushNotification(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      { title: event.title, body: event.body, tag: event.eventType, url: event.url }
    );
    if (success) sent++;
  }

  await prisma.notificationHistory.create({
    data: {
      eventType: event.eventType,
      title: event.title,
      body: event.body,
      metadata: event.metadata ? JSON.parse(JSON.stringify(event.metadata)) : undefined,
    },
  });

  return sent;
}
