import webpush from 'web-push';
import { createHash } from 'crypto';
import https from 'https';
import util from 'util';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';

let vapidInitialized = false;
let vapidMissingLogged = false;

const PUSH_TIMEOUT_MS = 10_000;
const CONSECUTIVE_FAILURE_LIMIT = 10;
// Concurrent notifyEvent() calls can both fail against the same dead endpoint
// inside one polling cycle. Without a window, both `increment: 1` updates land
// and the row reaches CONSECUTIVE_FAILURE_LIMIT faster than the threshold
// implies. Only count one failure per endpoint per debounce window.
const FAILURE_INCREMENT_DEBOUNCE_MS = 1000;

// Force IPv4 and reuse TLS sockets. Without family:4 the default agent runs
// Happy Eyeballs (autoSelectFamily=true since Node 19) which races IPv6 and
// IPv4 attempts on a 250ms-per-attempt budget — Apple's web push connect
// from this network sits just above that budget, so every attempt is killed
// right before it would have succeeded and the whole AggregateError bubbles
// up with ETIMEDOUT.
const webPushAgent = new https.Agent({
  keepAlive: true,
  family: 4,
  maxSockets: 20,
  timeout: PUSH_TIMEOUT_MS,
});

const TTL_BY_EVENT: Record<string, number> = {
  grabbed: 60,
  imported: 60,
  downloadFailed: 300,
  importFailed: 300,
  torrentAdded: 60,
  torrentCompleted: 60,
  torrentDeleted: 60,
  jellyfinPlaybackStart: 60,
  jellyfinItemAdded: 3600,
  healthWarning: 3600,
  upcomingPremiere: 86400,
  cleanupStrike: 60,
  cleanupRemoved: 60,
  watchlistReminder: 86400,
};

function ttlForTag(tag: string | undefined): number {
  if (!tag) return 300;
  const base = tag.split('-')[0];
  return TTL_BY_EVENT[base] ?? 300;
}

function isRetriableUpstream(statusCode?: number): boolean {
  // Treat status-less errors (network / DNS / connection reset / timeout) as
  // retriable — a transient outage shouldn't poison the failure counter and
  // prune live devices in 10 polls.
  if (statusCode === undefined) return true;
  return (
    statusCode === 429 ||
    statusCode === 500 ||
    statusCode === 502 ||
    statusCode === 503 ||
    statusCode === 504
  );
}

function isImmediateDeletion(statusCode?: number): boolean {
  return statusCode === 410 || statusCode === 404;
}

function hashEndpoint(endpoint: string): string {
  return createHash('sha256').update(endpoint).digest('hex').slice(0, 16);
}

export function buildTag(eventType: string, metadata: Record<string, unknown> | undefined): string {
  const m = metadata ?? {};
  const id = m.episodeId ?? m.movieId ?? m.hash ?? m.sessionId ?? m.id;
  return id !== undefined && id !== null ? `${eventType}-${String(id)}` : eventType;
}

export function safeNotificationMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
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
    'cleaner',
    'cleanupRuleName',
    'cleanupReason',
    'cleanupAction',
    'cleanupStrikeType',
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
  // Idempotent — early-returns once initialized. Cheap to call per-send
  // because Next.js loads each API route in a separate module instance,
  // so the startup-time init in instrumentation.ts does NOT persist into
  // request handlers (e.g. POST /api/notifications/test). Without this
  // call, route-driven pushes silently no-op even though polling-driven
  // pushes work fine.
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
      JSON.stringify(payload),
      { timeout: PUSH_TIMEOUT_MS, TTL: ttlForTag(payload.tag), agent: webPushAgent }
    );
    logger.debug('Push notification sent', {
      endpointHash,
      tag: payload.tag,
    }, { scope: 'notifications' });
    await prisma.pushSubscription.update({
      where: { endpoint: subscription.endpoint },
      data: { consecutiveFailures: 0, lastSucceededAt: new Date() },
    }).catch(() => {});
    return true;
  } catch (error: unknown) {
    const errObj = error as Record<string, unknown> & Partial<Error>;
    const statusCode = typeof errObj?.statusCode === 'number' ? errObj.statusCode : undefined;
    logger.warn('Push notification failed', {
      endpointHash,
      tag: payload.tag,
      errorName: errObj?.name,
      message: typeof errObj?.message === 'string' ? errObj.message : String(error),
      statusCode,
      body: typeof errObj?.body === 'string' ? errObj.body.slice(0, 500) : undefined,
      headers: errObj?.headers,
      stack: typeof errObj?.stack === 'string' ? errObj.stack.slice(0, 500) : undefined,
      inspect: util.inspect(error, { depth: 3 }).slice(0, 1500),
    }, { scope: 'notifications' });

    if (isImmediateDeletion(statusCode)) {
      await prisma.pushSubscription.delete({
        where: { endpoint: subscription.endpoint },
      }).catch(() => {});
      logger.info('Deleted stale push subscription (gone)', {
        endpointHash,
        statusCode,
      }, { scope: 'notifications' });
    } else if (!isRetriableUpstream(statusCode)) {
      // Atomic increment: only bump consecutiveFailures if lastFailedAt is null
      // or older than the debounce window. Two concurrent failures against the
      // same dead endpoint can't both increment because the second updateMany
      // sees lastFailedAt within the window and matches zero rows.
      const cutoff = new Date(Date.now() - FAILURE_INCREMENT_DEBOUNCE_MS);
      const incrementResult = await prisma.pushSubscription.updateMany({
        where: {
          endpoint: subscription.endpoint,
          OR: [{ lastFailedAt: null }, { lastFailedAt: { lt: cutoff } }],
        },
        data: { consecutiveFailures: { increment: 1 }, lastFailedAt: new Date() },
      }).catch(() => null);

      if (incrementResult && incrementResult.count > 0) {
        const updated = await prisma.pushSubscription.findUnique({
          where: { endpoint: subscription.endpoint },
          select: { consecutiveFailures: true },
        }).catch(() => null);
        if (updated && updated.consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
          await prisma.pushSubscription.delete({
            where: { endpoint: subscription.endpoint },
          }).catch(() => {});
          logger.info('Deleted stale push subscription (consecutive failures)', {
            endpointHash,
            consecutiveFailures: updated.consecutiveFailures,
          }, { scope: 'notifications' });
        }
      } else {
        // Debounced — bump lastFailedAt only, so the window slides forward.
        await prisma.pushSubscription.update({
          where: { endpoint: subscription.endpoint },
          data: { lastFailedAt: new Date() },
        }).catch(() => {});
      }
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
    where: { revokedAt: null },
    include: { preferences: true },
  });

  const tag = buildTag(event.eventType, metadata);

  type SendOutcome = { kind: 'sent' } | { kind: 'failed' } | { kind: 'skipped' };
  const results = await Promise.allSettled(
    subscriptions.map(async (sub): Promise<SendOutcome> => {
      const pref = sub.preferences.find((p) => p.eventType === event.eventType);
      if (pref?.enabled === false) return { kind: 'skipped' };
      const success = await sendPushNotification(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        { title: event.title, body: event.body, tag, url: targetUrl }
      );
      return { kind: success ? 'sent' : 'failed' };
    })
  );

  let sent = 0;
  let skippedByPreference = 0;
  let attempted = 0;
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    if (result.value.kind === 'skipped') skippedByPreference++;
    else {
      attempted++;
      if (result.value.kind === 'sent') sent++;
    }
  }

  if (!metadataRedirect && targetUrl) {
    metadata.redirect = targetUrl;
  }

  await prisma.notificationHistory.create({
    data: {
      eventType: event.eventType,
      title: event.title,
      body: event.body,
      metadata: JSON.parse(JSON.stringify({
        ...metadata,
        sentCount: sent,
        attempted,
        skippedByPreference,
      })),
    },
  });
  if (sent > 0) {
    logger.info('Notification history written', {
      eventType: event.eventType,
      sentCount: sent,
      metadata: safeNotificationMetadata(metadata),
    }, { scope: 'notifications' });
  } else {
    logger.info('Notification history written with no pushes sent', {
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
    historyWritten: true,
  }, { scope: 'notifications' });

  return sent;
}
