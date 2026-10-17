// Notification preferences section of a settings import.

import type { Prisma } from '@prisma/client';
import { EVENT_TYPES } from '@/lib/notification-events';
import type { ExportedNotificationDevice } from '@/lib/settings-export';

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
  let applied = 0;
  for (const rule of device.rules ?? []) {
    if (typeof rule.eventType !== 'string' || !(EVENT_TYPES as readonly string[]).includes(rule.eventType)) {
      continue;
    }
    await tx.notificationPreference.upsert({
      where: {
        subscriptionId_eventType: {
          subscriptionId: subscription.id,
          eventType: rule.eventType,
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
        eventType: rule.eventType,
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
