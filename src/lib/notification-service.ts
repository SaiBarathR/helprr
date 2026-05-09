import webpush from 'web-push';
import { createHash } from 'crypto';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';

let vapidInitialized = false;
let vapidMissingLogged = false;

function hashEndpoint(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex').slice(0, 16);
}

function safeNotificationMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata) return {};
  const safeKeys = [
    'source',
    'id',
    'movieId',
    'seriesId',
    'seasonNumber',
    'episodeId',
    'hash',
    'sessionId',
    'redirect',
  ];
  return Object.fromEntries(
    safeKeys
      .filter((key) => metadata[key] !== undefined)
      .map((key) => [key, metadata[key]])
  );
}

export function initVapid() {
  if (vapidInitialized) return;
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;

  if (!subject || !publicKey || !privateKey) {
    if (!vapidMissingLogged) {
      vapidMissingLogged = true;
      logger.warn('VAPID keys not configured; push notifications disabled', {
        hasSubject: Boolean(subject),
        hasPublicKey: Boolean(publicKey),
        hasPrivateKey: Boolean(privateKey),
      }, { scope: 'notifications' });
    }
    return;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidInitialized = true;
  logger.info('VAPID push notifications initialized', {}, { scope: 'notifications' });
}

export async function sendPushNotification(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: { title: string; body: string; tag?: string; url?: string }
): Promise<boolean> {
  initVapid();
  const endpointHash = hashEndpoint(subscription.endpoint);
  if (!vapidInitialized) {
    logger.debug('Skipping push send because VAPID is not initialized', {
      endpointHash,
      tag: payload.tag,
    }, { scope: 'notifications' });
    return false;
  }

  try {
    logger.debug('Sending push notification', {
      endpointHash,
      tag: payload.tag,
      title: payload.title,
      url: payload.url,
    }, { scope: 'notifications' });
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload)
    );
    logger.debug('Push notification sent', {
      endpointHash,
      tag: payload.tag,
    }, { scope: 'notifications' });
    return true;
  } catch (error: unknown) {
    const statusCode = (error as { statusCode?: number })?.statusCode;
    logger.warn('Push notification failed', {
      endpointHash,
      tag: payload.tag,
      statusCode,
      message: error instanceof Error ? error.message : String(error),
    }, { scope: 'notifications' });
    if (statusCode === 410 || statusCode === 404) {
      await prisma.pushSubscription.delete({
        where: { endpoint: subscription.endpoint },
      }).catch(() => {});
      logger.info('Deleted stale push subscription', {
        endpointHash,
        statusCode,
      }, { scope: 'notifications' });
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
  const metadata = { ...(event.metadata ?? {}) };
  const metadataRedirect = typeof metadata.redirect === 'string' ? metadata.redirect : undefined;
  const targetUrl = metadataRedirect ?? event.url;
  const safeMetadata = safeNotificationMetadata(metadata);
  logger.info('Notification event received', {
    eventType: event.eventType,
    title: event.title,
    url: targetUrl,
    metadata: safeMetadata,
  }, { scope: 'notifications' });

  const subscriptions = await prisma.pushSubscription.findMany({
    include: { preferences: true },
  });

  let sent = 0;
  let skippedByPreference = 0;
  let attempted = 0;

  for (const sub of subscriptions) {
    const pref = sub.preferences.find((p) => p.eventType === event.eventType);
    if (pref?.enabled === false) {
      skippedByPreference++;
      continue;
    }

    attempted++;
    const success = await sendPushNotification(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      { title: event.title, body: event.body, tag: event.eventType, url: targetUrl }
    );
    if (success) sent++;
  }

  if (sent > 0) {
    if (!metadataRedirect && targetUrl) {
      metadata.redirect = targetUrl;
    }

    await prisma.notificationHistory.create({
      data: {
        eventType: event.eventType,
        title: event.title,
        body: event.body,
        metadata: JSON.parse(JSON.stringify({ ...metadata, sentCount: sent })),
      },
    });
    logger.info('Notification history written', {
      eventType: event.eventType,
      sentCount: sent,
      metadata: safeNotificationMetadata(metadata),
    }, { scope: 'notifications' });
  } else {
    logger.info('Notification history not written because no pushes were sent', {
      eventType: event.eventType,
      subscriptionCount: subscriptions.length,
      attempted,
      skippedByPreference,
      sentCount: sent,
      metadata: safeMetadata,
    }, { scope: 'notifications' });
  }

  logger.info('Notification event completed', {
    eventType: event.eventType,
    subscriptionCount: subscriptions.length,
    skippedByPreference,
    attempted,
    sentCount: sent,
    historyWritten: sent > 0,
  }, { scope: 'notifications' });

  return sent;
}
