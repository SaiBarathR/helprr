import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { invalidateRecommendations } from './engine';
import { forgetExcludedItems, forgetLikedItems } from './profile-store';

// A title's rating from the Rate control: thumbs-down, thumbs-up or "Love this".
// Stored as the recommendation events the engine already reads (dislike, like,
// love), one per title: setting a rating replaces the previous one, so the
// latest wins. A thumbs-down is a permanent exclude only while it exists.

export const RATINGS = ['down', 'up', 'love'] as const;
export type Rating = (typeof RATINGS)[number];

const EVENT_OF: Record<Rating, string> = { down: 'dislike', up: 'like', love: 'love' };
export const RATING_OF: Record<string, Rating> = { dislike: 'down', like: 'up', love: 'love' };
const RATING_EVENT_TYPES = Object.values(EVENT_OF);
const EXCLUDE_EVENT_TYPES = ['dislike', 'not_interested'];

export function isRating(value: unknown): value is Rating {
  return typeof value === 'string' && (RATINGS as readonly string[]).includes(value);
}

export async function getRating(userId: string, itemKey: string): Promise<Rating | null> {
  const row = await prisma.recommendationEvent.findFirst({
    where: { userId, itemKey, eventType: { in: RATING_EVENT_TYPES } },
    orderBy: { createdAt: 'desc' },
    select: { eventType: true },
  });
  return row ? RATING_OF[row.eventType] ?? null : null;
}

/** Replace (or clear, with null) this user's rating of one title. */
export async function setRating(userId: string, itemKey: string, rating: Rating | null, genres?: string[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const forget = await replaceRating(tx, userId, itemKey, rating, genres);
    await forgetInProfile(tx, userId, [forget]);
  });
  await invalidateRecommendations(userId);
}

/** What a rating change takes back from the stored profile (see forgetInProfile). */
export interface ProfileForget { itemKey: string; liked: boolean; excluded: boolean }

/**
 * Drop what ratings took back from the stored profile, which keeps likes and
 * excludes for up to 6 hours. Called once, after every title lock of the
 * transaction: the UPDATE locks the user's profile row, and taking it between
 * two title locks could deadlock with another save of the second title.
 */
export async function forgetInProfile(tx: Prisma.TransactionClient, userId: string, changes: ProfileForget[]): Promise<void> {
  const liked = [...new Set(changes.filter((change) => change.liked).map((change) => change.itemKey))];
  const excluded = [...new Set(changes.filter((change) => change.excluded).map((change) => change.itemKey))];
  if (liked.length > 0) await forgetLikedItems(userId, liked, tx);
  if (excluded.length > 0) await forgetExcludedItems(userId, excluded, tx);
}

/**
 * The rating change itself, inside the caller's transaction. Every rating goes
 * through here, the feed's thumbs included, so the latest always wins. `event`
 * keeps a feed rating's rail and context on the stored event. Returns what the
 * caller must then drop from the profile (forgetInProfile, after all its title
 * locks), and invalidates recommendations once its transaction has committed.
 */
export async function replaceRating(
  tx: Prisma.TransactionClient,
  userId: string,
  itemKey: string,
  rating: Rating | null,
  genres?: string[],
  event?: { railId?: string; context?: Prisma.InputJsonValue },
): Promise<ProfileForget> {
  // One rating change per user and title at a time: two quick clicks must not
  // both delete before either inserts and leave two ratings behind.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${itemKey}`}))`;
  await tx.recommendationEvent.deleteMany({
    where: { userId, itemKey, eventType: { in: RATING_EVENT_TYPES } },
  });
  if (rating) {
    await tx.recommendationEvent.create({
      data: {
        userId,
        itemKey,
        eventType: EVENT_OF[rating],
        ...(event?.railId ? { railId: event.railId } : {}),
        ...(event?.context ? { context: event.context } : genres?.length ? { context: { genres } } : {}),
      },
    });
  }
  // What this rating took back. A cleared thumbs-down lets the title back
  // unless "Not interested" still holds it.
  const excluded = rating !== 'down'
    && (await tx.recommendationEvent.count({ where: { userId, itemKey, eventType: { in: EXCLUDE_EVENT_TYPES } } })) === 0;
  return { itemKey, liked: rating !== 'up' && rating !== 'love', excluded };
}
