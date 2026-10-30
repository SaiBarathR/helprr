import type { Prisma, TwitchVideoType } from '@prisma/client';
import { prisma } from '@/lib/db';

const EXPIRING_WINDOW_MS = 7 * 86_400_000;
const TYPES = new Set<string>(['ARCHIVE', 'HIGHLIGHT', 'UPLOAD']);
const LENGTHS: Record<string, Prisma.IntFilter> = {
  short: { lt: 3600 },
  medium: { gte: 3600, lt: 3 * 3600 },
  long: { gte: 3 * 3600 },
};

/** Subscribed streamers, minus what the user hid. New = not seen, and not older than the subscription. */
export async function buildFeedWhere(
  userId: string,
  params: URLSearchParams,
  now = new Date(),
): Promise<Prisma.TwitchVideoWhereInput> {
  const subscriptions = await prisma.twitchSubscription.findMany({
    where: { userId },
    select: { streamerId: true, createdAt: true },
  });

  const type = params.get('type');
  const streamer = params.get('streamer');
  const length = params.get('length');
  const q = params.get('q')?.trim().slice(0, 100);
  const and: Prisma.TwitchVideoWhereInput[] = [
    { streamerId: { in: subscriptions.map((subscription) => subscription.streamerId) } },
    { userStates: { none: { userId, hidden: true } } },
    { availability: { not: 'UNAVAILABLE' } },
  ];

  if (params.get('segment') === 'new') {
    and.push({ userStates: { none: { userId, seenAt: { not: null } } } });
    and.push({
      OR: subscriptions.map((subscription) => ({
        streamerId: subscription.streamerId,
        twitchCreatedAt: { gte: subscription.createdAt },
      })),
    });
  }
  if (type && TYPES.has(type)) and.push({ type: type as TwitchVideoType });
  if (streamer) and.push({ streamerId: streamer });
  if (length && LENGTHS[length]) and.push({ durationSeconds: LENGTHS[length] });
  if (params.get('notDownloaded') === '1') and.push({ mediaFiles: { none: {} } });
  if (params.get('expiring') === '1') {
    and.push({ estimatedExpiresAt: { gt: now, lte: new Date(now.getTime() + EXPIRING_WINDOW_MS) } });
  }
  if (q) {
    and.push({
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { streamer: { displayName: { contains: q, mode: 'insensitive' } } },
      ],
    });
  }
  return { AND: and };
}
