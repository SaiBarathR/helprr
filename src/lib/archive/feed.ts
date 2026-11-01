import type { ArchivePlatform, Prisma, CreatorVideoType } from '@prisma/client';
import { prisma } from '@/lib/db';

const DAY_MS = 86_400_000;
const EXPIRING_WINDOW_MS = 7 * DAY_MS;
const SINCE_DAYS: Record<string, number> = { week: 7, month: 30, quarter: 90 };
const TYPES: Record<ArchivePlatform, Set<string>> = {
  TWITCH: new Set(['ARCHIVE', 'HIGHLIGHT', 'UPLOAD']),
  YOUTUBE: new Set(['UPLOAD', 'ARCHIVE', 'SHORT']),
};
const LENGTHS: Record<string, Prisma.IntFilter> = {
  short: { lt: 3600 },
  medium: { gte: 3600, lt: 3 * 3600 },
  long: { gte: 3 * 3600 },
};

/** Subscribed creators, minus what the user hid. New = not seen, and first announced after the subscription began. */
export async function buildFeedWhere(
  platform: ArchivePlatform,
  userId: string,
  params: URLSearchParams,
  now = new Date(),
): Promise<Prisma.CreatorVideoWhereInput> {
  const subscriptions = await prisma.creatorSubscription.findMany({
    where: { userId, creator: { platform } },
    select: { creatorId: true, createdAt: true, creator: { select: { baselinedAt: true } } },
  });

  const type = params.get('type');
  const streamer = params.get('streamer');
  const length = params.get('length');
  const q = params.get('q')?.trim().slice(0, 100);
  const and: Prisma.CreatorVideoWhereInput[] = [
    { platform },
    { creatorId: { in: subscriptions.map((subscription) => subscription.creatorId) } },
    { userStates: { none: { userId, hidden: true } } },
    { availability: { not: 'UNAVAILABLE' } },
  ];

  if (params.get('segment') === 'new') {
    and.push({ userStates: { none: { userId, seenAt: { not: null } } } });
    // Not by stream date: a VOD can publish long after its stream began. The baseline
    // stamps what already existed with its own time, so `gt` leaves all of that out.
    and.push({
      OR: subscriptions.map(({ creatorId, createdAt, creator: streamer }) => ({
        creatorId,
        notifiedAt: { gt: streamer.baselinedAt && streamer.baselinedAt > createdAt ? streamer.baselinedAt : createdAt },
      })),
    });
  }
  if (type && TYPES[platform].has(type)) and.push({ type: type as CreatorVideoType });
  // Shorts would crowd out everything else, so they only appear when asked for.
  else if (platform === 'YOUTUBE') and.push({ type: { not: 'SHORT' } });
  if (streamer) and.push({ creatorId: streamer });
  if (length && LENGTHS[length]) and.push({ durationSeconds: LENGTHS[length] });
  const category = params.get('category');
  if (category) and.push({ category });
  const since = SINCE_DAYS[params.get('since') ?? ''];
  if (since) and.push({ sourceCreatedAt: { gte: new Date(now.getTime() - since * DAY_MS) } });
  if (params.get('notDownloaded') === '1') and.push({ mediaFiles: { none: {} } });
  if (params.get('downloaded') === '1') and.push({ mediaFiles: { some: {} } });
  if (params.get('expiring') === '1') {
    and.push({ estimatedExpiresAt: { gt: now, lte: new Date(now.getTime() + EXPIRING_WINDOW_MS) } });
  }
  if (q) {
    and.push({
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { creator: { displayName: { contains: q, mode: 'insensitive' } } },
      ],
    });
  }
  return { AND: and };
}
