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

const later = (first: Date | null, second: Date) => (first && first > second ? first : second);

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

  // Only YouTube has lists, and a list's videos count even when their channel is not followed.
  const lists = platform === 'YOUTUBE'
    ? await prisma.creatorPlaylistSubscription.findMany({
      where: { userId },
      select: { playlistId: true, createdAt: true, playlist: { select: { baselinedAt: true } } },
    })
    : [];
  const creatorIds = subscriptions.map((subscription) => subscription.creatorId);

  const type = params.get('type');
  const streamer = params.get('streamer');
  const length = params.get('length');
  const q = params.get('q')?.trim().slice(0, 100);
  const and: Prisma.CreatorVideoWhereInput[] = [
    { platform },
    lists.length > 0
      ? { OR: [{ creatorId: { in: creatorIds } }, { playlists: { some: { playlistId: { in: lists.map((list) => list.playlistId) } } } }] }
      : { creatorId: { in: creatorIds } },
    { userStates: { none: { userId, hidden: true } } },
    { availability: { not: 'UNAVAILABLE' } },
  ];

  if (params.get('segment') === 'new') {
    and.push({ userStates: { none: { userId, seenAt: { not: null } } } });
    // Not by stream date: a VOD can publish long after its stream began. The baseline
    // stamps what already existed with its own time, so `gt` leaves all of that out.
    const news: Prisma.CreatorVideoWhereInput[] = [
      ...subscriptions.map(({ creatorId, createdAt, creator }) => ({
        creatorId,
        notifiedAt: { gt: later(creator.baselinedAt, createdAt) },
      })),
      ...lists.map(({ playlistId, createdAt, playlist }) => ({
        playlists: { some: { playlistId, createdAt: { gt: later(playlist.baselinedAt, createdAt) } } },
      })),
    ];
    and.push({ OR: news });
  }
  if (type && TYPES[platform].has(type)) and.push({ type: type as CreatorVideoType });
  // Shorts would crowd out everything else, so they only appear when asked for.
  else if (platform === 'YOUTUBE') and.push({ type: { not: 'SHORT' } });
  if (streamer) and.push({ creatorId: streamer });
  const playlist = params.get('playlist');
  if (playlist) and.push({ playlists: { some: { playlistId: playlist } } });
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

/** What the category filter offers. Helix has no category for a video, so older ones have none. */
export async function feedCategories(platform: ArchivePlatform, userId: string): Promise<string[]> {
  const rows = await prisma.creatorVideo.findMany({
    where: { platform, creator: { subscriptions: { some: { userId } } }, category: { not: null } },
    distinct: ['category'],
    orderBy: { category: 'asc' },
    select: { category: true },
    take: 100,
  });
  return rows.map((row) => row.category!);
}
