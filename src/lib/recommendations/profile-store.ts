import type { User } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
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
    collectJellyfinSignals(user).catch(() => null),
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
  const built = await buildProfileForUser(user);
  const json = built.profile as unknown as Prisma.InputJsonValue;
  await prisma.userTasteProfile.upsert({
    where: { userId: user.id },
    create: { userId: user.id, profile: json, version: PROFILE_VERSION, builtAt: new Date() },
    update: { profile: json, version: PROFILE_VERSION, builtAt: new Date() },
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
