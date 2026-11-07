import type { NotificationChannel } from '@prisma/client';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { OutboundRules } from '@/lib/outbound-url';
import { isChannelType } from './catalog';
import { decryptSecrets, toFieldMap } from './config';
import { ChannelSendError, sendToChannel, type ChannelMessage } from './transports';

// Delivery to outbound channels, after notifyEvent has decided who may receive
// an event. Runs off the caller's path: notifyEvent does not wait for it, so a
// slow or dead endpoint never holds up a polling cycle, and a failing channel
// backs off (5 minutes, doubling to 6 hours) instead of being tried every event.

const CHANNEL_FANOUT_CONCURRENCY = 5;
const BACKOFF_BASE_MS = 5 * 60 * 1000;
const BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;
const MAX_REASON_LENGTH = 120;
// Like push: failures of one channel within this window count once, so a burst
// of events against an endpoint that is down for a moment does not jump
// straight to the longest backoff.
const FAILURE_INCREMENT_DEBOUNCE_MS = 60 * 1000;

export function channelBackoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, Math.min(failures - 1, 10)));
}

/** True while a failing channel is still inside its backoff window. */
export function shouldDeferChannel(
  channel: Pick<NotificationChannel, 'consecutiveFailures' | 'lastFailedAt' | 'lastSucceededAt'>,
  now = Date.now(),
): boolean {
  if (channel.consecutiveFailures <= 0 || !channel.lastFailedAt) return false;
  if (channel.lastSucceededAt && channel.lastSucceededAt >= channel.lastFailedAt) return false;
  return now - channel.lastFailedAt.getTime() < channelBackoffMs(channel.consecutiveFailures);
}

export type DeliveryResult = { ok: true } | { ok: false; reason: string };

async function recordOutcome(channelId: string, result: DeliveryResult): Promise<void> {
  try {
    if (result.ok) {
      await prisma.notificationChannel.update({
        where: { id: channelId },
        data: { consecutiveFailures: 0, lastSucceededAt: new Date(), lastError: null },
      });
      return;
    }
    const now = new Date();
    const lastError = result.reason.slice(0, MAX_REASON_LENGTH);
    const counted = await prisma.notificationChannel.updateMany({
      where: {
        id: channelId,
        OR: [{ lastFailedAt: null }, { lastFailedAt: { lt: new Date(now.getTime() - FAILURE_INCREMENT_DEBOUNCE_MS) } }],
      },
      data: { consecutiveFailures: { increment: 1 }, lastFailedAt: now, lastError },
    });
    if (counted.count === 0) {
      await prisma.notificationChannel.updateMany({ where: { id: channelId }, data: { lastFailedAt: now, lastError } });
    }
  } catch {
    // Deleted while the send was in flight, or the database is down: the send itself already happened (or not).
  }
}

/** Send to one channel and record the outcome on its row. `rules` is the owner's reach. Never throws. */
export async function deliverToChannel(
  channel: NotificationChannel,
  message: ChannelMessage,
  rules: OutboundRules,
): Promise<DeliveryResult> {
  let result: DeliveryResult;
  const secrets = decryptSecrets(channel.secrets);
  if (!isChannelType(channel.type)) {
    result = { ok: false, reason: 'Unknown channel type' };
  } else if (secrets === null) {
    result = { ok: false, reason: 'Saved secrets cannot be read' };
  } else {
    try {
      await sendToChannel(channel.type, toFieldMap(channel.config), secrets, message, rules);
      result = { ok: true };
    } catch (error) {
      result = { ok: false, reason: error instanceof ChannelSendError ? error.reason : 'Could not connect' };
    }
  }
  await recordOutcome(channel.id, result);

  if (!result.ok) {
    // Names and the fixed reason only: never the channel's URL, topic or any secret.
    logger.warn('Notification channel send failed', {
      channelId: channel.id,
      channelType: channel.type,
      eventType: message.eventType,
      reason: result.reason,
    }, { scope: 'notifications' });
  }
  return result;
}

// One send at a time per channel in this process: a burst of events reaches a
// channel in order, and once one fails, the rest queued behind it are dropped
// until the backoff's first window has passed, instead of each waiting out
// its own timeout against the same dead endpoint.
const channelQueues = new Map<string, Promise<unknown>>();
const recentFailures = new Map<string, number>();

function enqueue(channelId: string, run: () => Promise<boolean>): Promise<boolean> {
  const previous = channelQueues.get(channelId) ?? Promise.resolve();
  const next = previous.then(run, run);
  channelQueues.set(channelId, next);
  void next.finally(() => {
    if (channelQueues.get(channelId) === next) channelQueues.delete(channelId);
  });
  return next;
}

export type DispatchChannel = NotificationChannel & { user: { role: string } };

/** Deliver to every channel with bounded concurrency. Resolves to the number sent; never rejects. */
export async function dispatchToChannels(channels: DispatchChannel[], message: ChannelMessage): Promise<number> {
  let next = 0;
  let sent = 0;
  const worker = async () => {
    while (next < channels.length) {
      const channel = channels[next++];
      const ok = await enqueue(channel.id, async () => {
        // A failure newer than the row this send was queued with (an edit since resets it).
        const failedAt = recentFailures.get(channel.id);
        if (failedAt !== undefined && failedAt > channel.updatedAt.getTime() && Date.now() - failedAt < BACKOFF_BASE_MS) {
          return false;
        }
        const result = await deliverToChannel(channel, message, { allowPrivate: channel.user.role === 'admin' });
        if (result.ok) recentFailures.delete(channel.id);
        else recentFailures.set(channel.id, Date.now());
        return result.ok;
      }).catch(() => false);
      if (ok) sent++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CHANNEL_FANOUT_CONCURRENCY, channels.length) }, worker));
  return sent;
}
