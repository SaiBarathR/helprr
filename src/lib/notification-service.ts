import webpush from 'web-push';
import { createHash } from 'crypto';
import https from 'https';
import util from 'util';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { can } from '@/lib/permissions';
import { EVENT_TYPE_TO_CAPABILITY } from '@/lib/capabilities';
import { isKnownEventType } from '@/lib/notification-events';
import { getAppTimeZone, toZonedDate } from '@/lib/timezone';

let vapidInitialized = false;
let vapidMissingLogged = false;

const PUSH_TIMEOUT_MS = 10_000;
const CONSECUTIVE_FAILURE_LIMIT = 10;
const RETRIABLE_BACKOFF_BASE_MS = 5 * 60 * 1000;
const RETRIABLE_BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;
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
  serviceDown: 3600,
  serviceRestored: 3600,
  diskLowSpace: 3600,
  upcomingPremiere: 86400,
  cleanupStrike: 60,
  cleanupRemoved: 60,
  watchlistReminder: 86400,
  scheduledAlert: 86400,
  requestCreated: 60,
  requestApproved: 60,
  requestAvailable: 300,
  requestDeclined: 60,
  requestFailed: 300,
};

function ttlForTag(tag: string | undefined): number {
  if (!tag) return 300;
  const base = tag.split('-')[0];
  return TTL_BY_EVENT[base] ?? 300;
}

function isRetriableUpstream(statusCode?: number): boolean {
  // Treat status-less errors (network / DNS / connection reset / timeout) as
  // retriable. They still enter the durable backoff counter, so retries are
  // spread out instead of hammering a slow or dead endpoint every cycle.
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

function pushBackoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(
    RETRIABLE_BACKOFF_MAX_MS,
    RETRIABLE_BACKOFF_BASE_MS * Math.pow(2, Math.min(failures - 1, 10)),
  );
}

function shouldDeferPush(sub: {
  endpoint: string;
  consecutiveFailures: number;
  lastFailedAt: Date | null;
  lastSucceededAt: Date | null;
}): boolean {
  if (sub.consecutiveFailures <= 0 || !sub.lastFailedAt) return false;
  if (sub.lastSucceededAt && sub.lastSucceededAt >= sub.lastFailedAt) return false;
  return Date.now() - sub.lastFailedAt.getTime() < pushBackoffMs(sub.consecutiveFailures);
}

export function buildTag(eventType: string, metadata: Record<string, unknown> | undefined): string {
  const m = metadata ?? {};
  const id = m.episodeId ?? m.movieId ?? m.hash ?? m.sessionId ?? m.id;
  return id !== undefined && id !== null ? `${eventType}-${String(id)}` : eventType;
}

// Action buttons + the data the service worker needs to act on them without
// opening the app. requestCreated → Approve/Decline; downloadFailed → Retry.
// Only emitted where there's a clean server action to call. iOS ignores the
// buttons (it falls back to the deep-link), so these are a progressive
// enhancement for Android/desktop.
function buildNotificationActions(
  eventType: string,
  metadata: Record<string, unknown>,
): { actions?: { action: string; title: string }[]; data?: Record<string, unknown> } {
  if (eventType === 'requestCreated' && metadata.id != null) {
    return {
      actions: [
        { action: 'approve', title: 'Approve' },
        { action: 'decline', title: 'Decline' },
      ],
      data: { pendingId: String(metadata.id) },
    };
  }
  if (eventType === 'downloadFailed') {
    if (metadata.source === 'sonarr' && metadata.episodeId != null) {
      return {
        actions: [{ action: 'retry', title: 'Retry' }],
        data: { source: 'sonarr', instanceId: metadata.instanceId ?? null, episodeId: metadata.episodeId },
      };
    }
    if (metadata.source === 'radarr' && metadata.movieId != null) {
      return {
        actions: [{ action: 'retry', title: 'Retry' }],
        data: { source: 'radarr', instanceId: metadata.instanceId ?? null, movieId: metadata.movieId },
      };
    }
  }
  return {};
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
    'scheduledAlertId',
    'scheduledOccurrenceId',
    'mediaType',
    'releaseKind',
    'releaseAt',
  ];
  return Object.fromEntries(
    safeKeys
      .filter((key) => metadata[key] !== undefined)
      .map((key) => [key, metadata[key]])
  );
}

// Tag/quality filters only make sense for the per-item download/import events
// that actually carry quality + tag metadata. Calendar/health/request/etc.
// events ignore the filters entirely.
const FILTERABLE_EVENTS = new Set(['grabbed', 'imported', 'downloadFailed', 'importFailed']);

// Critical alerts always break through a user's quiet hours — a service going
// down at 3am is exactly what they'd want to know about.
const QUIET_HOURS_BYPASS_EVENTS = new Set(['healthWarning', 'serviceDown', 'serviceRestored']);

interface QuietHoursSettings {
  quietHoursEnabled: boolean;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  timeZone: string | null;
}

// True if `now` falls inside the recipient's quiet-hours window, evaluated in
// the user's own timezone (falling back to the app's global timezone). The
// window is hour-aligned [start, end); start > end means it crosses midnight
// (e.g. 23 → 7). Disabled / incomplete config is never "within".
function isWithinQuietHours(
  user: { settings?: QuietHoursSettings | null } | null,
  now: Date,
): boolean {
  const s = user?.settings;
  if (!s || !s.quietHoursEnabled || s.quietHoursStart == null || s.quietHoursEnd == null) return false;
  const start = s.quietHoursStart;
  const end = s.quietHoursEnd;
  if (start === end) return false; // zero-length window = effectively off
  const hour = toZonedDate(now, s.timeZone ?? getAppTimeZone()).getHours();
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

function parseFilterList(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Per-device include-filter: when a quality and/or tag filter is set on a
// filterable event, the item must match (case-insensitive). Quality matches if
// the item's quality name is in the list; tags match if ANY of the item's tag
// labels is in the list. A set filter with no matching item data → no match
// (that's the point of "only 4K"). Events that aren't filterable, or prefs with
// no filters, always pass.
function matchesFilters(
  pref:
    | { tagFilter: string | null; qualityFilter: string | null; mutedUserFilter: string | null }
    | undefined,
  eventType: string,
  metadata: Record<string, unknown>,
): boolean {
  if (!pref) return true;

  // Playback events use a MUTE list instead: entries name the streaming
  // Jellyfin user (by name or id); a match suppresses the push. New/unlisted
  // users keep notifying by default.
  if (eventType === 'jellyfinPlaybackStart') {
    const muted = parseFilterList(pref.mutedUserFilter);
    if (muted.length === 0) return true;
    const identifiers = [metadata.jellyfinUserId, metadata.jellyfinUserName]
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.toLowerCase());
    return !identifiers.some((v) => muted.includes(v));
  }

  if (!FILTERABLE_EVENTS.has(eventType)) return true;

  const qualityFilter = parseFilterList(pref.qualityFilter);
  if (qualityFilter.length > 0) {
    // A grouped notification carries the union of its items' qualities in
    // qualityNames; match if any of them (or the single qualityName) is filtered in.
    const qualities = [
      ...(typeof metadata.qualityName === 'string' ? [metadata.qualityName] : []),
      ...(Array.isArray(metadata.qualityNames) ? metadata.qualityNames.map((q) => String(q)) : []),
    ].map((q) => q.toLowerCase());
    if (!qualities.some((q) => qualityFilter.includes(q))) return false;
  }

  const tagFilter = parseFilterList(pref.tagFilter);
  if (tagFilter.length > 0) {
    const tags = Array.isArray(metadata.tags)
      ? metadata.tags.map((t) => String(t).toLowerCase())
      : [];
    if (!tags.some((t) => tagFilter.includes(t))) return false;
  }

  return true;
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
  payload: {
    title: string;
    body: string;
    tag?: string;
    url?: string;
    actions?: { action: string; title: string }[];
    data?: Record<string, unknown>;
  }
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
    } else {
      const retriable = isRetriableUpstream(statusCode);
      // Atomic increment: only bump consecutiveFailures if lastFailedAt is null
      // or older than the debounce window. Two concurrent failures against the
      // same dead endpoint can't both increment because the second updateMany
      // sees lastFailedAt within the window and matches zero rows. Backoff gates
      // future attempts, so the delete threshold is spread over time.
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
            retriable,
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

// Cap concurrent push sends so a burst of events across many users × devices
// can't pile up all at once against the web-push agent's 20-socket pool
// (webPushAgent above).
const PUSH_FANOUT_CONCURRENCY = 10;

// Promise.allSettled with a concurrency limit: runs `fn` over `items` with at
// most `limit` in flight, preserves input order, and never rejects — every
// result is settled, exactly like Promise.allSettled.
async function mapSettled<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const runWorker = async (): Promise<void> => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i]) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, runWorker);
  await Promise.all(workers);
  return results;
}

export async function notifyEvent(event: {
  eventType: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  url?: string;
  dedupeKey?: string;
  // When set, only these users' devices are eligible (e.g. a watchlist reminder
  // targets the item's owner). Omit for broadcast-to-all-capable.
  userIds?: string[];
  // Stamped onto the NotificationHistory row so an owned event shows in the
  // owner's in-app list; leave undefined for instance/global events (null).
  ownerUserId?: string | null;
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
    where: {
      revokedAt: null,
      ...(event.userIds ? { userId: { in: event.userIds } } : {}),
    },
    include: { preferences: true, user: { include: { settings: true } } },
  });

  const tag = buildTag(event.eventType, metadata);
  const now = new Date();
  const bypassesQuietHours = QUIET_HOURS_BYPASS_EVENTS.has(event.eventType);
  const { actions, data: actionData } = buildNotificationActions(event.eventType, metadata);

  // Outer gate: the owning user must hold the capability mapped to this event
  // type (a Member never receives cleanup/health/admin pushes). Unmapped event
  // types are admin-only. The per-device NotificationPreference.enabled is the
  // inner gate, checked after.
  const requiredCap = isKnownEventType(event.eventType)
    ? EVENT_TYPE_TO_CAPABILITY[event.eventType]
    : undefined;

  type SendOutcome = { kind: 'sent' } | { kind: 'failed' } | { kind: 'skipped' };
  const results = await mapSettled(subscriptions, PUSH_FANOUT_CONCURRENCY, async (sub): Promise<SendOutcome> => {
      if (shouldDeferPush(sub)) return { kind: 'skipped' };
      if (requiredCap) {
        if (!sub.user || !can(sub.user, requiredCap)) return { kind: 'skipped' };
      } else if (!sub.user || (sub.user.role !== 'admin' && !event.userIds)) {
        // Unmapped event types broadcast to admins only — unless the caller
        // explicitly targeted users (e.g. a member's own test notification).
        return { kind: 'skipped' };
      }
      const pref = sub.preferences.find((p) => p.eventType === event.eventType);
      if (pref?.enabled === false) return { kind: 'skipped' };
      if (!matchesFilters(pref, event.eventType, metadata)) return { kind: 'skipped' };
      if (!bypassesQuietHours && isWithinQuietHours(sub.user, now)) return { kind: 'skipped' };
      const success = await sendPushNotification(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        { title: event.title, body: event.body, tag, url: targetUrl, actions, data: actionData }
      );
      return { kind: success ? 'sent' : 'failed' };
  });

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

  // Owner-less subscriptions are skipped by the gate above. Post-reset every
  // subscription has a userId, so this surfaces the anomaly (e.g. a botched
  // backfill) instead of silently delivering nothing.
  if (attempted === 0 && subscriptions.some((sub) => !sub.user)) {
    logger.warn('Push skipped: owner-less subscriptions encountered', {
      eventType: event.eventType,
      subscriptionCount: subscriptions.length,
    }, { scope: 'notifications' });
  }

  if (!metadataRedirect && targetUrl) {
    metadata.redirect = targetUrl;
  }

  let historyWritten = false;
  try {
    await prisma.notificationHistory.create({
      data: {
        eventType: event.eventType,
        userId: event.ownerUserId ?? null,
        title: event.title,
        body: event.body,
        dedupeKey: event.dedupeKey ?? null,
        metadata: JSON.parse(JSON.stringify({
          ...metadata,
          sentCount: sent,
          attempted,
          skippedByPreference,
        })),
      },
    });
    historyWritten = true;
  } catch (err) {
    logger.warn('Notification history write failed', {
      eventType: event.eventType,
      reason: err instanceof Error ? err.message : String(err),
      sentCount: sent,
    }, { scope: 'notifications' });
  }
  if (historyWritten) {
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
  }

  logger.info('Notification event completed', {
    eventType: event.eventType,
    subscriptionCount: subscriptions.length,
    skippedByPreference,
    attempted,
    sentCount: sent,
    historyWritten,
  }, { scope: 'notifications' });

  return sent;
}
