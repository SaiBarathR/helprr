// Notification preferences section of a settings import.

import type { Prisma } from '@prisma/client';
import { EVENT_TYPES, type NotificationEventType } from '@/lib/notification-events';
import type { ExportedNotificationDevice, ExportedUsers } from '@/lib/settings-export';

/**
 * Events added after another one, each starting from that older event's choice
 * (as their migrations did), and the users-section marker of a file made since.
 * A file from before the newer event keeps the older one's choice for both.
 */
export const LATER_EVENTS: ReadonlyArray<{
  from: NotificationEventType;
  to: NotificationEventType;
  marker: 'upgradedEvent' | 'healthRestoredEvent';
}> = [
  { from: 'imported', to: 'upgraded', marker: 'upgradedEvent' },
  { from: 'healthWarning', to: 'healthRestored', marker: 'healthRestoredEvent' },
];

/** The later events a users section predates (it lacks their marker). */
export function laterEventsMissingFrom(users: ExportedUsers): typeof LATER_EVENTS {
  return LATER_EVENTS.filter((event) => users[event.marker] !== true);
}

export async function applyNotificationDeviceInTxn(
  tx: Prisma.TransactionClient,
  device: ExportedNotificationDevice,
  currentDeviceEndpoint: string | undefined,
  skipped: string[]
): Promise<number> {
  if (!currentDeviceEndpoint) {
    skipped.push('Notification prefs: no active push subscription on this device');
    return 0;
  }
  const subscription = await tx.pushSubscription.findUnique({
    where: { endpoint: currentDeviceEndpoint },
    select: { id: true },
  });
  if (!subscription) {
    skipped.push('Notification prefs: current device push subscription not found');
    return 0;
  }
  // One rule per event type, the last one listed winning, so a file cannot
  // repeat an event to multiply the writes.
  const rules = new Map<string, (typeof device.rules)[number]>();
  for (const rule of Array.isArray(device.rules) ? device.rules : []) {
    if (!rule || typeof rule.eventType !== 'string' || !(EVENT_TYPES as readonly string[]).includes(rule.eventType)) {
      continue;
    }
    rules.set(rule.eventType, rule);
  }
  // A device exported before a later event (upgrades came as imports then, and
  // nothing followed a health warning) keeps the older event's choice for it
  // (on or off, with its filters), as the migrations did.
  for (const { from, to } of LATER_EVENTS) {
    const rule = rules.get(from);
    if (rule && !rules.has(to)) rules.set(to, { ...rule, eventType: to });
  }
  let applied = 0;
  for (const [eventType, rule] of rules) {
    await tx.notificationPreference.upsert({
      where: {
        subscriptionId_eventType: {
          subscriptionId: subscription.id,
          eventType,
        },
      },
      update: {
        enabled: Boolean(rule.enabled),
        tagFilter: rule.tagFilter ?? null,
        qualityFilter: rule.qualityFilter ?? null,
        mutedUserFilter: rule.mutedUserFilter ?? null,
      },
      create: {
        subscriptionId: subscription.id,
        eventType,
        enabled: Boolean(rule.enabled),
        tagFilter: rule.tagFilter ?? null,
        qualityFilter: rule.qualityFilter ?? null,
        mutedUserFilter: rule.mutedUserFilter ?? null,
      },
    });
    applied += 1;
  }
  return applied;
}
