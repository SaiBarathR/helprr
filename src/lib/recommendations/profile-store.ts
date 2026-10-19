import type { User } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { noteJobFailure } from '@/lib/polling-job-report';
import { buildTasteProfile } from './build-profile';
import { PROFILE_VERSION, type TasteProfile } from './profile-types';
import {
  collectAniListSignals,
  collectEventSignals,
  collectJellyfinSignals,
  collectWatchlistSignals,
} from './signals';

// Profile lifecycle: build from live signals, persist in Postgres (durable —
// a build costs Jellyfin scans + Playback Reporting SQL + AniList calls and
// must survive restarts and cache purges), rebuild when stale.

/** Rebuild when the stored profile is older than this (poll job + lazy read). */
export const PROFILE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

type ProfileUser = Pick<User, 'id' | 'role' | 'jellyfinUserId'>;

export interface BuiltProfile {
  profile: TasteProfile;
  /** AniList ids already on the user's list (any status) — rails exclude them from anime discovery. */
  listedAnilistIds: number[];
  /** Watchlist item keys — rails boost owned ones, exclude from discovery. */
  watchlistItemKeys: string[];
}

/** Collect every signal source (fail-soft each) and build a fresh profile. */
export async function buildProfileForUser(user: ProfileUser): Promise<BuiltProfile> {
  const [jellyfin, anilist, watchlist, events] = await Promise.all([
    // Unlinked or unconfigured Jellyfin returns empty signals; a throw is a failed read.
    collectJellyfinSignals(user).catch((error) => {
      noteJobFailure(error);
      return null;
    }),
    collectAniListSignals(user),
    collectWatchlistSignals(user.id),
    collectEventSignals(user.id),
  ]);

  const plays = jellyfin?.playbackReportingAvailable
    ? jellyfin.playbackReportingPlays
    : jellyfin?.recentPlays ?? [];

  const profile = buildTasteProfile({
    now: new Date(),
    engagedTitles: [...(jellyfin?.engagedTitles ?? []), ...anilist.engagedTitles],
    plays,
    playsFromPlaybackReporting: jellyfin?.playbackReportingAvailable ?? false,
    events,
    watchlist: [...watchlist.items, ...anilist.planned],
    listedAnilistIds: [...anilist.listedAnilistIds],
    sources: {
      jellyfin: jellyfin?.available ?? false,
      playbackReporting: jellyfin?.playbackReportingAvailable ?? false,
      anilist: anilist.available,
      watchlist: watchlist.available,
      events: events.hasEvents,
    },
  });

  return {
    profile,
    listedAnilistIds: [...anilist.listedAnilistIds],
    watchlistItemKeys: [...watchlist.itemKeys],
  };
}

/** Rebuild and persist. Returns the fresh profile. */
export async function rebuildTasteProfile(user: ProfileUser): Promise<TasteProfile> {
  const startedAt = new Date();
  const built = await buildProfileForUser(user);
  await prisma.$transaction(async (tx) => {
    // A build takes a while (Jellyfin scans), and a title restored meanwhile
    // has lost its exclude events but may still be in what was read at the
    // start. Lock the stored row, keep only the excludes still backed by an
    // event, then write: a restore's profile UPDATE waits for this lock and
    // then removes its key from what was written here.
    await lockTasteProfile(tx, user.id);
    await tx.$queryRaw`SELECT 1 FROM "UserTasteProfile" WHERE "userId" = ${user.id} FOR UPDATE`;
    const excluded = built.profile.negatives.excludedItemKeys;
    if (excluded.length > 0) {
      const stillExcluded = await tx.recommendationEvent.findMany({
        where: { userId: user.id, eventType: { in: ['not_interested', 'dislike'] }, itemKey: { in: excluded } },
        select: { itemKey: true },
        distinct: ['itemKey'],
      });
      const live = new Set(stillExcluded.map((row) => row.itemKey));
      built.profile.negatives.excludedItemKeys = excluded.filter((key) => live.has(key));
    }
    // Likewise a like or love taken back meanwhile: keep only liked keys still rated.
    const liked = built.profile.likedItemKeys;
    if (liked.length > 0) {
      const stillLiked = await tx.recommendationEvent.findMany({
        where: { userId: user.id, eventType: { in: ['like', 'love'] }, itemKey: { in: liked } },
        select: { itemKey: true },
        distinct: ['itemKey'],
      });
      const live = new Set(stillLiked.map((row) => row.itemKey));
      built.profile.likedItemKeys = liked.filter((key) => live.has(key));
    }
    // Stored, but left stale for the next read to rebuild, when what this
    // build read may already be out of date: a link changed while it ran (a
    // stale mark landed after it started), or the user it was handed was read
    // before a link or role change (a request in flight, a polling sweep's list).
    // Only markTasteProfileStale writes markedAt, so neither this write nor a
    // forget* edit can pass for a mark.
    const stored = await tx.userTasteProfile.findUnique({ where: { userId: user.id }, select: { markedAt: true } });
    const current = await tx.user.findUnique({ where: { id: user.id }, select: { role: true, jellyfinUserId: true } });
    const markedMeanwhile = stored?.markedAt != null && stored.markedAt >= startedAt;
    const userChanged = current !== null && (current.role !== user.role || current.jellyfinUserId !== user.jellyfinUserId);
    const builtAt = markedMeanwhile || userChanged ? new Date(0) : new Date();
    const json = built.profile as unknown as Prisma.InputJsonValue;
    await tx.userTasteProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, profile: json, version: PROFILE_VERSION, builtAt },
      update: { profile: json, version: PROFILE_VERSION, builtAt },
    });
  });
  return built.profile;
}

function parseStoredProfile(row: { profile: Prisma.JsonValue; version: number; builtAt: Date }): TasteProfile | null {
  if (row.version !== PROFILE_VERSION) return null;
  const value = row.profile;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const profile = value as unknown as TasteProfile;
  return profile.version === PROFILE_VERSION ? profile : null;
}

/**
 * Serializes writes to one user's stored profile, including its first creation
 * (when there is no row for FOR UPDATE to lock). Rating writers take it after
 * all their title locks, a restore after deleting its events, and a rebuild
 * before reading the events it reconciles against.
 */
export function lockTasteProfile(tx: RawExecutor, userId: string) {
  return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`taste-profile:${userId}`}))`;
}

/** Prisma's client or a transaction's, for the raw profile edits below. */
type RawExecutor = Pick<Prisma.TransactionClient, '$executeRaw'>;

/**
 * Drop item keys from the stored profile's hard excludes without a rebuild
 * (which costs Jellyfin scans), so a title the user asked to see again
 * returns on the next compose instead of after the profile's 6h staleness.
 * One UPDATE edits the JSON in place, so two restores at once can't write
 * back each other's stale list. Returns the query for a caller's transaction;
 * the built-at time is kept, since the rest of the profile is as fresh as before.
 */
export function forgetExcludedItems(userId: string, itemKeys: string[], db: RawExecutor = prisma) {
  return db.$executeRaw`
    UPDATE "UserTasteProfile"
    SET "profile" = jsonb_set(
          "profile",
          '{negatives,excludedItemKeys}',
          COALESCE(
            (SELECT jsonb_agg(key)
               FROM jsonb_array_elements("profile"->'negatives'->'excludedItemKeys') AS key
              WHERE NOT (key #>> '{}' = ANY(${itemKeys}::text[]))),
            '[]'::jsonb
          )
        ),
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "userId" = ${userId}
      AND jsonb_typeof("profile"->'negatives'->'excludedItemKeys') = 'array'`;
}

/** Like forgetExcludedItems, for the liked keys a taken-back like should stop boosting. */
export function forgetLikedItems(userId: string, itemKeys: string[], db: RawExecutor = prisma) {
  return db.$executeRaw`
    UPDATE "UserTasteProfile"
    SET "profile" = jsonb_set(
          "profile",
          '{likedItemKeys}',
          COALESCE(
            (SELECT jsonb_agg(key)
               FROM jsonb_array_elements("profile"->'likedItemKeys') AS key
              WHERE NOT (key #>> '{}' = ANY(${itemKeys}::text[]))),
            '[]'::jsonb
          )
        ),
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "userId" = ${userId}
      AND jsonb_typeof("profile"->'likedItemKeys') = 'array'`;
}

/**
 * Leave the stored profile to be rebuilt on its next read, or by the polling
 * sweep, instead of rebuilding it now (a rebuild scans Jellyfin). For a change
 * to what the profile reads: the user's Jellyfin user or AniList link.
 */
export function markTasteProfileStale(userIds: string | string[], db: Pick<Prisma.TransactionClient, 'userTasteProfile'> = prisma) {
  const userId = typeof userIds === 'string' ? userIds : { in: userIds };
  return db.userTasteProfile.updateMany({ where: { userId }, data: { builtAt: new Date(0), markedAt: new Date() } });
}

/**
 * Load the user's profile, rebuilding when missing, shape-versioned stale, or
 * older than PROFILE_MAX_AGE_MS. The read path is what most requests hit — a
 * fresh row costs one Postgres read.
 */
export async function getTasteProfile(user: ProfileUser): Promise<TasteProfile> {
  const row = await prisma.userTasteProfile.findUnique({ where: { userId: user.id } });
  if (row) {
    const stored = parseStoredProfile(row);
    if (stored && Date.now() - row.builtAt.getTime() < PROFILE_MAX_AGE_MS) {
      return stored;
    }
  }
  return rebuildTasteProfile(user);
}
