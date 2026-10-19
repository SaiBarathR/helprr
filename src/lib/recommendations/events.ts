import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';
import { isItemKey, tmdbItemKey } from './item-keys';
import { invalidateRecommendations } from './engine';
import { forgetInProfile, RATING_OF, replaceRating, type ProfileForget } from './ratings';
import { getRedisClient } from '@/lib/redis';

// Event ingestion: validated, batched, own-user only (the route passes the
// authenticated user's id — client-supplied user ids are never accepted).
// Explicit feedback busts the rails cache so the change is visible on the
// next read, not after the 15-minute TTL.

export const EVENT_TYPES = [
  'impression',
  'click',
  'play',
  'like',
  // "Love this" — the two-thumbs rating; a stronger like.
  'love',
  'dislike',
  'not_interested',
  'watchlist_add',
  'request',
] as const;
export type RecommendationEventType = (typeof EVENT_TYPES)[number];

/** Feedback that must change what the user sees immediately. */
const INSTANT_FEEDBACK: ReadonlySet<string> = new Set(['like', 'love', 'dislike', 'not_interested']);

export const MAX_EVENTS_PER_BATCH = 50;
const MAX_RAIL_ID_LENGTH = 80;
const MAX_GENRES = 10;
const MAX_GENRE_LENGTH = 40;

export function isValidGenreList(genres: unknown): genres is string[] {
  return Array.isArray(genres)
    && genres.length <= MAX_GENRES
    && genres.every((g) => typeof g === 'string' && g.length > 0 && g.length <= MAX_GENRE_LENGTH);
}
// Per-user ingestion ceiling: real browsing produces at most a few hundred
// impressions per window, so anything past this is a runaway client or abuse
// growing the events table. One indexed count() per batch checks it.
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_EVENTS_PER_WINDOW = 1000;

export interface IncomingEvent {
  itemKey: string;
  eventType: RecommendationEventType;
  railId?: string;
  context?: {
    position?: number;
    mode?: 'rails' | 'feed' | 'random';
    genres?: string[];
    exploration?: boolean;
  };
}

export type ParseResult =
  | { ok: true; events: IncomingEvent[] }
  | { ok: false; error: string };

/** Strict body validation — reject the whole batch on any malformed entry so
 * client bugs surface instead of silently thinning the signal stream. */
export function parseEventsBody(body: unknown): ParseResult {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { events?: unknown }).events)) {
    return { ok: false, error: 'Body must be { events: [...] }' };
  }
  const raw = (body as { events: unknown[] }).events;
  if (raw.length === 0) return { ok: false, error: 'events must not be empty' };
  if (raw.length > MAX_EVENTS_PER_BATCH) {
    return { ok: false, error: `events must contain at most ${MAX_EVENTS_PER_BATCH} entries` };
  }

  const events: IncomingEvent[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return { ok: false, error: 'Each event must be an object' };
    const { itemKey, eventType, railId, context } = entry as Record<string, unknown>;
    if (typeof itemKey !== 'string' || !isItemKey(itemKey)) {
      return { ok: false, error: `Invalid itemKey: ${String(itemKey).slice(0, 60)}` };
    }
    if (typeof eventType !== 'string' || !(EVENT_TYPES as readonly string[]).includes(eventType)) {
      return { ok: false, error: `Invalid eventType: ${String(eventType).slice(0, 40)}` };
    }
    if (railId !== undefined && (typeof railId !== 'string' || railId.length > MAX_RAIL_ID_LENGTH)) {
      return { ok: false, error: 'Invalid railId' };
    }

    let cleanContext: IncomingEvent['context'];
    if (context !== undefined) {
      if (!context || typeof context !== 'object' || Array.isArray(context)) {
        return { ok: false, error: 'Invalid context' };
      }
      const { position, mode, genres, exploration } = context as Record<string, unknown>;
      cleanContext = {};
      if (position !== undefined) {
        if (typeof position !== 'number' || !Number.isFinite(position) || position < 0 || position > 10_000) {
          return { ok: false, error: 'Invalid context.position' };
        }
        cleanContext.position = Math.floor(position);
      }
      if (mode !== undefined) {
        if (mode !== 'rails' && mode !== 'feed' && mode !== 'random') {
          return { ok: false, error: 'Invalid context.mode' };
        }
        cleanContext.mode = mode;
      }
      if (genres !== undefined) {
        if (!isValidGenreList(genres)) {
          return { ok: false, error: 'Invalid context.genres' };
        }
        cleanContext.genres = genres;
      }
      if (exploration !== undefined) {
        if (typeof exploration !== 'boolean') return { ok: false, error: 'Invalid context.exploration' };
        cleanContext.exploration = exploration;
      }
    }

    events.push({
      itemKey,
      eventType: eventType as RecommendationEventType,
      railId: typeof railId === 'string' ? railId : undefined,
      context: cleanContext,
    });
  }
  return { ok: true, events };
}

export type IngestResult = { ok: true; stored: number } | { ok: false; rateLimited: true };

/**
 * Events submitted in this window, this batch included. Counted as sent, not as
 * stored: a rating replaces the title's previous one, so stored rows undercount.
 * Null without Redis.
 */
async function countSubmitted(userId: string, count: number): Promise<number | null> {
  try {
    const redis = await getRedisClient();
    const key = `recommendations:events:${userId}:${Math.floor(Date.now() / RATE_WINDOW_MS)}`;
    // One MULTI, so the key never outlives its window without an expiry.
    const [total] = await redis.multi().incrBy(key, count).expire(key, Math.ceil((2 * RATE_WINDOW_MS) / 1000)).exec();
    return Number(total);
  } catch {
    return null;
  }
}

// Without Redis, submissions are counted in this process (stored rows would
// undercount for the same reason as above). Windows other than the current one
// are dropped as they pass.
const localSubmitted = new Map<string, number>();

function countSubmittedLocally(userId: string, count: number): number {
  const window = Math.floor(Date.now() / RATE_WINDOW_MS);
  for (const key of localSubmitted.keys()) {
    if (!key.endsWith(`:${window}`)) localSubmitted.delete(key);
  }
  const key = `${userId}:${window}`;
  const total = (localSubmitted.get(key) ?? 0) + count;
  localSubmitted.set(key, total);
  return total;
}

/**
 * Take `count` events from this user's quota; false when it is spent. Shared by
 * event ingestion and the Rate control's PUT, which write the same events.
 */
export async function takeEventQuota(userId: string, count: number): Promise<boolean> {
  const submitted = (await countSubmitted(userId, count)) ?? countSubmittedLocally(userId, count);
  return submitted <= RATE_MAX_EVENTS_PER_WINDOW;
}

/**
 * A title the user requested through Seerr, from any surface: a positive
 * taste signal through its genres (the profile learns events' genres, not
 * their titles). Recorded once per title, so requesting it again adds no weight.
 */
export async function recordRequestEvent(
  userId: string,
  mediaType: 'movie' | 'tv',
  tmdbId: number,
  genres?: string[],
): Promise<IngestResult> {
  const itemKey = tmdbItemKey(mediaType, tmdbId);
  const seen = await prisma.recommendationEvent.findFirst({ where: { userId, itemKey, eventType: 'request' }, select: { id: true } });
  if (seen) return { ok: true, stored: 0 };
  const known = genres?.filter((genre) => genre.length > 0 && genre.length <= MAX_GENRE_LENGTH).slice(0, MAX_GENRES);
  return ingestEvents(userId, [{ itemKey, eventType: 'request', ...(known?.length ? { context: { genres: known } } : {}) }]);
}

export async function ingestEvents(userId: string, events: IncomingEvent[]): Promise<IngestResult> {
  if (!(await takeEventQuota(userId, events.length))) {
    return { ok: false, rateLimited: true };
  }

  // A like, dislike or love is a rating: it replaces the title's previous one.
  // The whole batch commits or none of it, as one createMany did. Ratings take
  // their per-title locks in title order, so two batches cannot deadlock.
  const ratings = events
    .filter((event) => event.eventType in RATING_OF)
    .sort((a, b) => (a.itemKey < b.itemKey ? -1 : a.itemKey > b.itemKey ? 1 : 0));
  const others = events.filter((event) => !(event.eventType in RATING_OF));
  await prisma.$transaction(async (tx) => {
    const forgets: ProfileForget[] = [];
    for (const event of ratings) {
      forgets.push(await replaceRating(tx, userId, event.itemKey, RATING_OF[event.eventType], undefined, {
        railId: event.railId,
        context: (event.context ?? undefined) as Prisma.InputJsonValue | undefined,
      }));
    }
    // A title rated twice in one batch: only its last change counts.
    const last = new Map(forgets.map((forget) => [forget.itemKey, forget]));
    await forgetInProfile(tx, userId, [...last.values()]);
    if (others.length > 0) {
      await tx.recommendationEvent.createMany({
        data: others.map((event) => ({
          userId,
          itemKey: event.itemKey,
          eventType: event.eventType,
          railId: event.railId ?? null,
          context: (event.context ?? undefined) as Prisma.InputJsonValue | undefined,
        })),
      });
    }
  });

  if (ratings.length > 0 || events.some((event) => INSTANT_FEEDBACK.has(event.eventType))) {
    await invalidateRecommendations(userId);
  }
  return { ok: true, stored: events.length };
}
