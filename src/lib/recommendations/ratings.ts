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
  await prisma.$transaction((tx) => replaceRating(tx, userId, itemKey, rating, genres));
  await invalidateRecommendations(userId);
}

/**
 * The rating change itself, inside the caller's transaction. Every rating goes
 * through here, the feed's thumbs included, so the latest always wins. `event`
 * keeps a feed rating's rail and context on the stored event. The caller
 * invalidates recommendations once its transaction has committed.
 */
export async function replaceRating(
  tx: Prisma.TransactionClient,
  userId: string,
  itemKey: string,
  rating: Rating | null,
  genres?: string[],
  event?: { railId?: string; context?: Prisma.InputJsonValue },
): Promise<void> {
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
  // The stored profile keeps likes and excludes for up to 6 hours; drop what
  // this rating took back. A cleared thumbs-down lets the title back unless
  // "Not interested" still holds it.
  if (rating !== 'up' && rating !== 'love') await forgetLikedItems(userId, [itemKey], tx);
  if (rating !== 'down') {
    const stillExcluded = await tx.recommendationEvent.count({
      where: { userId, itemKey, eventType: { in: EXCLUDE_EVENT_TYPES } },
    });
    if (stillExcluded === 0) await forgetExcludedItems(userId, [itemKey], tx);
  }
}
