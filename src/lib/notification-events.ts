import { prisma } from '@/lib/db';

export const EVENT_TYPES = [
  'grabbed', 'imported', 'downloadFailed', 'importFailed',
  'upcomingPremiere', 'healthWarning',
  'torrentAdded', 'torrentCompleted', 'torrentDeleted',
  'jellyfinItemAdded', 'jellyfinPlaybackStart',
] as const;

export async function ensureNotificationPreferences(subscriptionId: string): Promise<void> {
  await prisma.notificationPreference.createMany({
    data: EVENT_TYPES.map((eventType) => ({
      subscriptionId,
      eventType,
      enabled: true,
    })),
    skipDuplicates: true,
  });
}
