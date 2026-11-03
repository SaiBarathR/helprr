import type { ArchivePlatform, Creator, Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';

interface SubscribeInput {
  platform: ArchivePlatform;
  externalId: string;
  userId: string;
  profile: Omit<Prisma.CreatorUncheckedCreateInput, 'platform' | 'externalId' | 'folderName'>;
  /** Only used for a creator seen for the first time: a folder is never renamed. */
  folderName: string;
  /** Records what already exists, so that following never floods anything. */
  baseline: (creator: Creator) => Promise<unknown>;
}

/** Subscribes a user, creating the creator and its baseline on first sight. */
export async function subscribeToCreator({ platform, externalId, userId, profile, folderName, baseline }: SubscribeInput) {
  const key = { platform_externalId: { platform, externalId } };
  const existing = await prisma.creator.findUnique({
    where: key,
    select: { _count: { select: { subscriptions: true } } },
  });
  // Unwatched for a while: what was published meanwhile is history, not news.
  const unwatched = existing?._count.subscriptions === 0;
  const creator = await prisma.creator.upsert({
    where: key,
    update: { ...profile, ...(unwatched ? { baselinedAt: null, nextVideosCheckAt: null } : {}) },
    create: { platform, externalId, folderName, ...profile },
  });
  const subscription = await prisma.creatorSubscription.upsert({
    where: { userId_creatorId: { userId, creatorId: creator.id } },
    update: {},
    create: { userId, creatorId: creator.id },
  });

  if (!creator.baselinedAt) {
    try {
      await baseline(creator);
      // A recording that published during the gap is already stored, so the sweep skips it.
      if (unwatched) {
        await prisma.creatorVideo.updateMany({
          where: { creatorId: creator.id, notifiedAt: null, availability: 'PUBLISHED' },
          data: { notifiedAt: new Date() },
        });
      }
    } catch (error) {
      // nextVideosCheckAt is still null, so the next poll takes the baseline instead.
      logger.warn('Creator baseline failed', { creatorId: creator.id, platform, error: String(error) }, { scope: 'twitch' });
    }
  }
  return { creator, subscription };
}
