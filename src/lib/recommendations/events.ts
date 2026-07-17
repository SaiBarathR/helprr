import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';
import { isItemKey } from './item-keys';
import { invalidateRecommendations } from './engine';

// Event ingestion: validated, batched, own-user only (the route passes the
// authenticated user's id — client-supplied user ids are never accepted).
// Explicit feedback busts the rails cache so the change is visible on the
// next read, not after the 15-minute TTL.

export const EVENT_TYPES = [
  'impression',
  'click',
  'play',
  'like',
  'dislike',
  'not_interested',
  'watchlist_add',
  'request',
] as const;
export type RecommendationEventType = (typeof EVENT_TYPES)[number];

/** Feedback that must change what the user sees immediately. */
const INSTANT_FEEDBACK: ReadonlySet<string> = new Set(['like', 'dislike', 'not_interested']);

export const MAX_EVENTS_PER_BATCH = 50;
const MAX_RAIL_ID_LENGTH = 80;
const MAX_GENRES = 10;
const MAX_GENRE_LENGTH = 40;
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
        if (
          !Array.isArray(genres)
          || genres.length > MAX_GENRES
          || genres.some((g) => typeof g !== 'string' || g.length === 0 || g.length > MAX_GENRE_LENGTH)
        ) {
          return { ok: false, error: 'Invalid context.genres' };
        }
        cleanContext.genres = genres as string[];
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

export async function ingestEvents(userId: string, events: IncomingEvent[]): Promise<IngestResult> {
  const windowStart = new Date(Date.now() - RATE_WINDOW_MS);
  const recentCount = await prisma.recommendationEvent.count({
    where: { userId, createdAt: { gte: windowStart } },
  });
  if (recentCount + events.length > RATE_MAX_EVENTS_PER_WINDOW) {
    return { ok: false, rateLimited: true };
  }

  await prisma.recommendationEvent.createMany({
    data: events.map((event) => ({
      userId,
      itemKey: event.itemKey,
      eventType: event.eventType,
      railId: event.railId ?? null,
      context: (event.context ?? undefined) as Prisma.InputJsonValue | undefined,
    })),
  });

  if (events.some((event) => INSTANT_FEEDBACK.has(event.eventType))) {
    await invalidateRecommendations(userId);
  }
  return { ok: true, stored: events.length };
}
