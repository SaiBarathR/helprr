import { randomBytes } from 'crypto';
import type { User } from '@prisma/client';
import type { getRedisClient } from '@/lib/redis';
import { can } from '@/lib/permissions';
import { logger } from '@/lib/logger';
import { notifyEvent } from '@/lib/notification-service';
import { isTonightSessionId } from '@/lib/tonight-pick-id';
import { fetchUserWatchStatusMap } from '@/lib/jellyfin-watch-status-map';
import { matchesRandomFilters } from '@/lib/random-watch-filters';
import {
  fetchMoviePool,
  fetchSeriesPool,
  isEligibleUnwatched,
  pickMovie,
  pickSeries,
} from '@/lib/random-watch-pool';
import type {
  TonightFilters,
  TonightParticipant,
  TonightStatus,
  TonightTitle,
  TonightView,
} from '@/types/tonight';

export { isTonightSessionId };

// ─────────────────────────────────────────────────────────────────────────────
// Household "Tonight" pick: a short-lived group vote on the same ~20 Random
// titles. Everything lives in ONE Redis hash per session with one expiry, so
// there is no table to migrate and nothing to clean up by hand:
//
//   meta              JSON TonightMeta (starter, invited, titles, filters)
//   join:<userId>     ms the person joined
//   vote:<userId>:<i> '1' yes / '0' no on title i — written once (HSETNX)
//   winner            title index; HSETNX, so the first unanimous title wins
//   ended             ms the starter ended it
//
// Every write goes in a MULTI with PEXPIREAT at the session's expiry, so a write
// that lands just after the hash expired is deleted at once instead of leaving
// an orphan hash without a TTL.
// ─────────────────────────────────────────────────────────────────────────────

export type TonightRedis = Awaited<ReturnType<typeof getRedisClient>>;

export const TONIGHT_TITLE_COUNT = 20;
export const TONIGHT_MAX_INVITEES = 8;
export const TONIGHT_TTL_MS = 3 * 60 * 60 * 1000;
/** How long an ended pick stays readable so the others see that it ended. */
export const TONIGHT_ENDED_TTL_MS = 15 * 60 * 1000;
const CREATE_LIMIT = 6;
const CREATE_WINDOW_SECONDS = 10 * 60;

const KEY_PREFIX = 'helprr:tonight:';

export interface TonightMeta {
  id: string;
  starterId: string;
  createdAt: number;
  expiresAt: number;
  filters: TonightFilters;
  /** Everyone allowed in, starter first. */
  invited: { id: string; name: string }[];
  titles: TonightTitle[];
  /** True when the pool is smaller than the starter's own because of the others. */
  narrowed: boolean;
}

export interface TonightState {
  meta: TonightMeta;
  joined: Set<string>;
  votes: Map<string, Map<number, boolean>>;
  winner: number | null;
  endedAt: number | null;
}

/** 128 random bits, base64url: unguessable, and the only shape a route accepts. */
export function newTonightSessionId(): string {
  return randomBytes(16).toString('base64url');
}

export function tonightKey(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

export function tonightLink(id: string): string {
  return `/recommendations?mode=random&tonight=${encodeURIComponent(id)}`;
}

export function parseTonightState(fields: Record<string, string>): TonightState | null {
  if (!fields.meta) return null;
  let meta: TonightMeta;
  try {
    meta = JSON.parse(fields.meta) as TonightMeta;
  } catch {
    return null;
  }
  const joined = new Set<string>();
  const votes = new Map<string, Map<number, boolean>>();
  for (const [field, value] of Object.entries(fields)) {
    if (field.startsWith('join:')) {
      joined.add(field.slice(5));
    } else if (field.startsWith('vote:')) {
      const sep = field.lastIndexOf(':');
      const userId = field.slice(5, sep);
      const index = Number(field.slice(sep + 1));
      if (!Number.isInteger(index)) continue;
      if (!votes.has(userId)) votes.set(userId, new Map());
      votes.get(userId)!.set(index, value === '1');
    }
  }
  const winner = fields.winner !== undefined ? Number(fields.winner) : null;
  return {
    meta,
    joined,
    votes,
    winner: winner !== null && Number.isInteger(winner) ? winner : null,
    endedAt: fields.ended ? Number(fields.ended) : null,
  };
}

/** When the hash should disappear: the session expiry, or soon after it was ended. */
export function tonightExpiry(state: TonightState): number {
  return state.endedAt !== null
    ? Math.min(state.meta.expiresAt, state.endedAt + TONIGHT_ENDED_TTL_MS)
    : state.meta.expiresAt;
}

export function tonightStatus(state: TonightState): TonightStatus {
  if (state.endedAt !== null) return 'ended';
  if (state.winner !== null) return 'matched';
  // Votes are final and a match needs every joiner's yes, so once each title
  // has a no from someone, no later vote or joiner can produce a match.
  const allRejected = state.meta.titles.every((_, index) =>
    [...state.votes.values()].some((byTitle) => byTitle.get(index) === false),
  );
  return allRejected ? 'noMatch' : 'open';
}

/** Whether title `index` now has a yes from everyone who joined (two or more people). */
export function isUnanimous(state: TonightState, index: number): boolean {
  if (state.joined.size < 2) return false;
  for (const userId of state.joined) {
    if (state.votes.get(userId)?.get(index) !== true) return false;
  }
  return true;
}

export function isInvited(state: TonightState, userId: string): boolean {
  return state.meta.invited.some((p) => p.id === userId);
}

/**
 * Whether `user` may see this session now: Random Watch, plus view rights for
 * every kind of title in it. Re-checked on every request so a capability taken
 * away mid-session applies at once (fail closed).
 */
export function canViewTonightTitles(user: Pick<User, 'role' | 'template' | 'permissions'>, state: TonightState): boolean {
  if (!can(user, 'random.view')) return false;
  const kinds = new Set(state.meta.titles.map((t) => t.mediaType));
  if (kinds.has('movie') && !can(user, 'movies.view')) return false;
  if (kinds.has('series') && !can(user, 'series.view')) return false;
  return true;
}

export function tonightView(state: TonightState, userId: string): TonightView {
  const status = tonightStatus(state);
  const mine = state.votes.get(userId) ?? new Map<number, boolean>();
  const participants: TonightParticipant[] = state.meta.invited.map((p) => ({
    id: p.id,
    name: p.name,
    isStarter: p.id === state.meta.starterId,
    joined: state.joined.has(p.id),
    voted: state.votes.get(p.id)?.size ?? 0,
  }));
  let nearMisses: TonightView['nearMisses'] = [];
  if (status === 'noMatch') {
    nearMisses = state.meta.titles
      .map((_, index) => ({
        index,
        yes: [...state.votes.values()].filter((byTitle) => byTitle.get(index) === true).length,
      }))
      .filter((m) => m.yes > 0)
      .sort((a, b) => b.yes - a.yes || a.index - b.index)
      .slice(0, 3);
  }
  return {
    id: state.meta.id,
    status,
    isStarter: userId === state.meta.starterId,
    starterName: state.meta.invited.find((p) => p.id === state.meta.starterId)?.name ?? 'Someone',
    filters: state.meta.filters,
    narrowed: state.meta.narrowed,
    titles: state.meta.titles,
    myVotes: Object.fromEntries([...mine.entries()].map(([i, yes]) => [String(i), yes])),
    participants,
    winnerIndex: status === 'matched' ? state.winner : null,
    nearMisses,
    expiresAt: new Date(tonightExpiry(state)).toISOString(),
  };
}

// ── Redis operations ─────────────────────────────────────────────────────────

export async function loadTonightSession(redis: TonightRedis, id: string): Promise<TonightState | null> {
  const fields = await redis.hGetAll(tonightKey(id));
  return parseTonightState(fields as Record<string, string>);
}

/** Counts a start toward the per-user limit; false once the limit is reached. */
export async function allowTonightStart(redis: TonightRedis, userId: string): Promise<boolean> {
  const key = `${KEY_PREFIX}starts:${userId}`;
  // SET NX EX opens a fixed window with its TTL in the same step; INCR keeps it.
  const [, count] = await redis.multi().set(key, '0', { EX: CREATE_WINDOW_SECONDS, NX: true }).incr(key).exec();
  return Number(count) <= CREATE_LIMIT;
}

export async function createTonightSession(
  redis: TonightRedis,
  input: Omit<TonightMeta, 'id' | 'createdAt' | 'expiresAt'>,
  now = Date.now(),
): Promise<TonightState> {
  const meta: TonightMeta = {
    ...input,
    id: newTonightSessionId(),
    createdAt: now,
    expiresAt: now + TONIGHT_TTL_MS,
  };
  const key = tonightKey(meta.id);
  await redis
    .multi()
    .hSet(key, { meta: JSON.stringify(meta), [`join:${meta.starterId}`]: String(now) })
    .pExpireAt(key, meta.expiresAt)
    .exec();
  return { meta, joined: new Set([meta.starterId]), votes: new Map(), winner: null, endedAt: null };
}

/**
 * Re-reads after a write made from `before`. If the starter ended the pick in
 * between, that write set the full expiry again, so put the shorter one back.
 */
async function reloadAfterWrite(redis: TonightRedis, before: TonightState): Promise<TonightState> {
  const next = (await loadTonightSession(redis, before.meta.id)) ?? before;
  if (before.endedAt === null && next.endedAt !== null) {
    await redis.pExpireAt(tonightKey(next.meta.id), tonightExpiry(next));
  }
  return next;
}

/**
 * Claims the win for the first unanimous title if none is stored yet. A vote
 * calls it right after writing; reads call it too, so a claim lost to an error
 * between the vote and the claim is repaired instead of leaving the pick stuck.
 * HSETNX means that when two claims race, the first stands.
 */
export async function claimTonightWinner(redis: TonightRedis, state: TonightState): Promise<TonightState> {
  if (state.winner !== null || tonightStatus(state) !== 'open') return state;
  const index = state.meta.titles.findIndex((_, i) => isUnanimous(state, i));
  if (index < 0) return state;
  const key = tonightKey(state.meta.id);
  await redis.multi().hSetNX(key, 'winner', String(index)).pExpireAt(key, tonightExpiry(state)).exec();
  return reloadAfterWrite(redis, state);
}

export async function joinTonightSession(redis: TonightRedis, state: TonightState, userId: string): Promise<TonightState> {
  if (state.joined.has(userId) || tonightStatus(state) === 'ended') return state;
  const key = tonightKey(state.meta.id);
  await redis.multi().hSetNX(key, `join:${userId}`, String(Date.now())).pExpireAt(key, tonightExpiry(state)).exec();
  return reloadAfterWrite(redis, state);
}

/**
 * Records one person's final yes/no on a title (voting also joins), then claims
 * the win if that made a title unanimous. Returns the state after the vote.
 */
export async function castTonightVote(
  redis: TonightRedis,
  state: TonightState,
  userId: string,
  index: number,
  yes: boolean,
): Promise<TonightState> {
  if (tonightStatus(state) !== 'open') return state;
  const key = tonightKey(state.meta.id);
  await redis
    .multi()
    .hSetNX(key, `join:${userId}`, String(Date.now()))
    .hSetNX(key, `vote:${userId}:${index}`, yes ? '1' : '0')
    .pExpireAt(key, tonightExpiry(state))
    .exec();
  return claimTonightWinner(redis, await reloadAfterWrite(redis, state));
}

export async function endTonightSession(redis: TonightRedis, state: TonightState, now = Date.now()): Promise<TonightState> {
  if (state.endedAt !== null) return state;
  const ended: TonightState = { ...state, endedAt: now };
  const key = tonightKey(state.meta.id);
  await redis.multi().hSet(key, 'ended', String(now)).pExpireAt(key, tonightExpiry(ended)).exec();
  return ended;
}

// ── Building the shared pool ─────────────────────────────────────────────────

type Participant = Pick<User, 'id' | 'role' | 'template' | 'permissions' | 'jellyfinUserId'>;

/** Whether `user` may be part of a pick of `type` at all. */
export function canJoinTonight(user: Pick<User, 'role' | 'template' | 'permissions' | 'status'>, type: TonightFilters['type']): boolean {
  if (user.status !== 'active' || !can(user, 'random.view')) return false;
  if (type === 'movie') return can(user, 'movies.view');
  if (type === 'series') return can(user, 'series.view');
  return can(user, 'movies.view') || can(user, 'series.view');
}

function sample<T>(items: T[], count: number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
}

/**
 * The titles every participant may see, within the genre and length filters:
 * a kind of title is in only when everyone may view it, and with "unwatched" a
 * title must be unwatched for each person whose Jellyfin watch state can be
 * read (like Random, anyone else is not filtered). `narrowed` says whether the
 * others made the pool smaller than the starter's own.
 */
export async function buildTonightTitles(
  starter: Participant,
  others: Participant[],
  filters: TonightFilters,
): Promise<{ titles: TonightTitle[]; narrowed: boolean }> {
  const everyone = [starter, ...others];
  const wantsMovies = filters.type !== 'series';
  const wantsSeries = filters.type !== 'movie';
  const starterMovies = wantsMovies && can(starter, 'movies.view');
  const starterSeries = wantsSeries && can(starter, 'series.view');
  const allMovies = starterMovies && others.every((u) => can(u, 'movies.view'));
  const allSeries = starterSeries && others.every((u) => can(u, 'series.view'));

  const maps = await Promise.all(everyone.map(async (u) => {
    if (filters.watch !== 'unwatched' || !can(u, 'jellyfin.view')) return null;
    try {
      return await fetchUserWatchStatusMap(u);
    } catch {
      return null;
    }
  }));
  const [starterMap] = maps;

  const [movies, series] = await Promise.all([
    starterMovies ? fetchMoviePool() : Promise.resolve([]),
    starterSeries ? fetchSeriesPool() : Promise.resolve([]),
  ]);

  let starterCount = 0;
  const shared: TonightTitle[] = [];
  for (const m of movies) {
    if (!matchesRandomFilters(m, filters) || !isEligibleUnwatched(starterMap, 'radarr', m.instanceId, m.id)) continue;
    starterCount++;
    if (!allMovies || !maps.every((map) => isEligibleUnwatched(map, 'radarr', m.instanceId, m.id))) continue;
    shared.push({ ...pickMovie(m), imdbId: m.imdbId || null, tmdbId: m.tmdbId || null, tvdbId: null });
  }
  for (const s of series) {
    if (!matchesRandomFilters(s, filters) || !isEligibleUnwatched(starterMap, 'sonarr', s.instanceId, s.id)) continue;
    starterCount++;
    if (!allSeries || !maps.every((map) => isEligibleUnwatched(map, 'sonarr', s.instanceId, s.id))) continue;
    shared.push({ ...pickSeries(s), imdbId: s.imdbId || null, tmdbId: s.tmdbId || null, tvdbId: s.tvdbId || null });
  }
  return { titles: sample(shared, TONIGHT_TITLE_COUNT), narrowed: shared.length < starterCount };
}

// ── Invites ──────────────────────────────────────────────────────────────────

export function tonightInviteTitle(starterName: string, type: TonightFilters['type']): string {
  const kind = type === 'movie' ? 'a movie pick' : type === 'series' ? 'a series pick' : 'a Tonight pick';
  return `${starterName} started ${kind}`;
}

/**
 * One push per invitee (their own copy in their notification list), through
 * notifyEvent so each device's preference, quiet hours and the capability gate
 * apply. Never throws: the copyable link still works when a push cannot go out.
 */
export async function sendTonightInvites(state: TonightState): Promise<void> {
  const starterName = state.meta.invited[0]?.name ?? 'Someone';
  const title = tonightInviteTitle(starterName, state.meta.filters.type);
  const url = tonightLink(state.meta.id);
  await Promise.all(state.meta.invited
    .filter((p) => p.id !== state.meta.starterId)
    .map((p) => notifyEvent({
      eventType: 'tonightPickInvite',
      title,
      body: `Swipe yes or no on ${state.meta.titles.length} titles. The first one everyone likes wins.`,
      url,
      metadata: { sessionId: state.meta.id },
      userIds: [p.id],
      ownerUserId: p.id,
      dedupeKey: `${state.meta.id}:${p.id}`,
    }).catch((error) => {
      logger.warn('Tonight pick invite push failed', {
        reason: error instanceof Error ? error.message : String(error),
      }, { scope: 'notifications' });
    })));
}
