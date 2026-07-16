import type { User } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getCachedJson, setCachedJson, deleteCachedJson } from '@/lib/cache/json-cache';
import { getCacheImagesEnabled, releaseCacheLock, tryAcquireCacheLock } from '@/lib/cache/state';
import { getJellyfinUserContext, isJellyfinUnavailable } from '@/lib/service-helpers';
import { getAppTimeZone, normalizeTimeZone, toZonedDate } from '@/lib/timezone';
import { arrKey } from '@/types/watch-status';
import type { JellyfinItem } from '@/types/jellyfin';
import { composeRecommendations } from './compose-rails';
import { buildAnimeCandidates, buildLibraryCandidates, buildTmdbDiscoveryCandidates } from './candidates';
import { getTasteProfile } from './profile-store';
import { collectWatchlistSignals } from './signals';
import { jellyfinItemKey, tmdbItemKey } from './item-keys';
import type { Candidate, FeedResponse, RecItem, RecommendationsResponse } from './rec-types';
import { lookupWatchStatus, type WatchStatusMapPayload } from '@/lib/jellyfin-watch-status-map';

// Engine orchestrator: profile + candidates → rails/feed, cached per user in
// Redis (short TTL) so the page is instant on revisit while feedback still
// applies immediately (explicit events bust the cache AND hard-excludes are
// re-read live on every compose).

const CACHE_SCOPE = 'recommendations';
const CACHE_TTL_SECONDS = 15 * 60;
const RESUME_LIMIT = 12;
const FEED_PAGE_SIZE = 20;
// Single-flight around snapshot builds (same pattern as
// jellyfin-watch-status-cache): a build fans out to Jellyfin + TMDB + AniList,
// so concurrent cold requests must not each run it. Losers of the lock poll
// briefly for the winner's result.
const LOCK_SCOPE = 'recommendations-snapshot';
const LOCK_TTL_MS = 60_000;
const WAIT_ATTEMPTS = 20;
const WAIT_DELAY_MS = 500;
// Recent-feedback reads at compose time are bounded; anyone with more
// explicit feedback than this keeps only the most recent (retention prunes
// the tail anyway, and hard-excludes also live in the profile).
const LIVE_FEEDBACK_LIMIT = 2000;

type EngineUser = Pick<User, 'id' | 'role' | 'jellyfinUserId'>;

interface EngineSnapshot {
  response: RecommendationsResponse;
  feed: RecItem[];
  builtAt: string;
}

function cacheSeed(userId: string): string {
  return `user:${userId}`;
}

// ─── Continue watching (Jellyfin resume → in-app items) ─────────────────────

function resumeToRecItem(
  item: JellyfinItem,
  ownedByJellyfinId: Map<string, Candidate>
): RecItem | null {
  const isEpisode = item.Type === 'Episode';
  const mapKey = isEpisode ? item.SeriesId : item.Id;
  const owned = mapKey ? ownedByJellyfinId.get(mapKey) : undefined;
  const progressPct = Math.round(item.UserData?.PlayedPercentage ?? 0);
  const episodeTag = isEpisode && item.ParentIndexNumber != null && item.IndexNumber != null
    ? `S${item.ParentIndexNumber}E${item.IndexNumber}`
    : null;

  if (owned) {
    return {
      itemKey: owned.itemKey,
      mediaType: owned.mediaType,
      tmdbId: owned.tmdbId,
      title: owned.title,
      year: owned.year,
      posterUrl: owned.posterUrl,
      backdropUrl: owned.backdropUrl,
      rating: owned.rating,
      runtimeMin: owned.runtimeMin,
      genres: owned.genres,
      overview: owned.overview,
      owned: true,
      arr: owned.arr,
      watch: { played: false, progressPct },
      href: owned.href,
      source: 'library',
      reason: episodeTag ? `${episodeTag} · ${item.Name}` : 'Pick up where you left off',
    };
  }

  // Jellyfin-only item (not matched to the arr library) — still resumable.
  // Episodes key on their SERIES id so two half-watched episodes of one
  // unmatched show still collapse to a single card.
  const tmdbId = !isEpisode && item.ProviderIds?.Tmdb ? Number(item.ProviderIds.Tmdb) : null;
  const title = isEpisode ? item.SeriesName ?? item.Name : item.Name;
  if (!title) return null;
  return {
    itemKey: tmdbId
      ? tmdbItemKey('movie', tmdbId)
      : jellyfinItemKey(isEpisode ? item.SeriesId ?? item.Id : item.Id),
    mediaType: isEpisode ? 'tv' : 'movie',
    tmdbId: tmdbId ?? undefined,
    title,
    year: item.ProductionYear ?? null,
    posterUrl: `/api/jellyfin/image?itemId=${encodeURIComponent(isEpisode ? item.SeriesId ?? item.Id : item.Id)}&type=Primary`,
    backdropUrl: null,
    rating: item.CommunityRating ?? null,
    runtimeMin: null,
    genres: item.Genres ?? [],
    overview: item.Overview ?? null,
    owned: false,
    watch: { played: false, progressPct },
    href: tmdbId ? `/discover/movie/${tmdbId}` : '#',
    source: 'library',
    reason: episodeTag ? `${episodeTag} · ${item.Name}` : 'Pick up where you left off',
  };
}

async function fetchContinueWatching(
  user: EngineUser,
  library: Candidate[],
  watchMap: WatchStatusMapPayload | null
): Promise<RecItem[]> {
  let context;
  try {
    context = await getJellyfinUserContext(user);
  } catch (error) {
    if (isJellyfinUnavailable(error)) return [];
    throw error;
  }

  // Reverse map: Jellyfin item id → owned candidate, via the watch-status map
  // (whose entries carry the matched Jellyfin item id per arr title).
  const ownedByJellyfinId = new Map<string, Candidate>();
  if (watchMap) {
    for (const candidate of library) {
      if (!candidate.arr) continue;
      const status = lookupWatchStatus(watchMap, arrKey(candidate.arr.scope, candidate.arr.instanceId, candidate.arr.id));
      if (status) ownedByJellyfinId.set(status.jellyfinItemId, candidate);
    }
  }

  try {
    const resume = await context.client.getResumeItems({
      limit: RESUME_LIMIT,
      extraFields: 'ProviderIds,Genres',
    });
    const items: RecItem[] = [];
    const seen = new Set<string>();
    for (const item of resume.Items ?? []) {
      const mapped = resumeToRecItem(item, ownedByJellyfinId);
      // Two half-watched episodes of one series must collapse to one card.
      if (!mapped || seen.has(mapped.itemKey)) continue;
      seen.add(mapped.itemKey);
      items.push(mapped);
    }
    return items;
  } catch {
    return [];
  }
}

// ─── Snapshot build ──────────────────────────────────────────────────────────

async function resolveLocalHour(userId: string, now: Date): Promise<number> {
  try {
    const settings = await prisma.userSettings.findUnique({
      where: { userId },
      select: { timeZone: true },
    });
    const timeZone = normalizeTimeZone(settings?.timeZone, getAppTimeZone());
    return toZonedDate(now, timeZone).getHours();
  } catch {
    return now.getHours();
  }
}

/** Explicit feedback re-read live at compose time — the persisted profile can
 * be up to 6h old, but a like/not_interested must act on the very next
 * compose (the ingest path busts the rails cache to force that compose). */
async function loadLiveFeedback(userId: string): Promise<{ excluded: Set<string>; liked: Set<string> }> {
  const rows = await prisma.recommendationEvent.findMany({
    where: { userId, eventType: { in: ['not_interested', 'dislike', 'like'] } },
    select: { itemKey: true, eventType: true },
    distinct: ['itemKey', 'eventType'],
    orderBy: { createdAt: 'desc' },
    take: LIVE_FEEDBACK_LIMIT,
  });
  const excluded = new Set<string>();
  const liked = new Set<string>();
  for (const row of rows) {
    if (row.eventType === 'like') liked.add(row.itemKey);
    else excluded.add(row.itemKey);
  }
  return { excluded, liked };
}

async function buildSnapshot(user: EngineUser): Promise<EngineSnapshot> {
  const now = new Date();
  const [profile, libraryResult, watchlist, liveFeedback, localHour] = await Promise.all([
    getTasteProfile(user),
    buildLibraryCandidates(user),
    collectWatchlistSignals(user.id),
    loadLiveFeedback(user.id),
    resolveLocalHour(user.id, now),
  ]);

  const [discovery, anime, continueWatching] = await Promise.all([
    buildTmdbDiscoveryCandidates(profile, libraryResult.libraryItemKeys, watchlist.itemKeys),
    profile.anime.signalMass > 1
      ? buildAnimeCandidates(new Set(profile.listedAnilistIds))
      : Promise.resolve([]),
    fetchContinueWatching(user, libraryResult.candidates, libraryResult.watchMap),
  ]);

  const composed = composeRecommendations({
    profile,
    library: libraryResult.candidates,
    discovery,
    anime,
    continueWatching,
    watchlistItemKeys: watchlist.itemKeys,
    liveExcludedItemKeys: liveFeedback.excluded,
    liveLikedItemKeys: liveFeedback.liked,
    now,
    localHour,
    // Day-scoped seed: rails reshuffle daily, stay stable within a day.
    rngSeed: `${user.id}:${now.toISOString().slice(0, 10)}`,
  });

  return {
    response: {
      rails: composed.rails,
      sources: profile.sources,
      profileBuiltAt: profile.builtAt,
    },
    feed: composed.feed,
    builtAt: now.toISOString(),
  };
}

async function getSnapshot(user: EngineUser): Promise<EngineSnapshot> {
  const seed = cacheSeed(user.id);
  const cached = await getCachedJson<EngineSnapshot>(CACHE_SCOPE, seed);
  if (cached) return cached;

  // Single-flight on a cold key. When the global cache toggle is off the
  // cache never fills, so waiting on the lock would only add latency — build
  // directly (the toggle is an explicit operator choice).
  const cachingEnabled = await getCacheImagesEnabled();
  const lockToken = cachingEnabled ? await tryAcquireCacheLock(LOCK_SCOPE, seed, LOCK_TTL_MS) : null;
  if (cachingEnabled && !lockToken) {
    for (let attempt = 0; attempt < WAIT_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, WAIT_DELAY_MS));
      const entry = await getCachedJson<EngineSnapshot>(CACHE_SCOPE, seed);
      if (entry) return entry;
    }
    // Lock holder never delivered — fall through and build ourselves.
  }

  try {
    const snapshot = await buildSnapshot(user);
    await setCachedJson(CACHE_SCOPE, seed, snapshot, CACHE_TTL_SECONDS);
    return snapshot;
  } finally {
    if (lockToken) void releaseCacheLock(LOCK_SCOPE, seed, lockToken);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function getRecommendationRails(user: EngineUser): Promise<RecommendationsResponse> {
  return (await getSnapshot(user)).response;
}

/** Cursor = "<builtAt>:<offset>". A cursor from an expired snapshot restarts
 * from the equivalent offset of the fresh one (same day → same ordering). */
export async function getRecommendationFeed(user: EngineUser, cursor: string | null): Promise<FeedResponse> {
  const snapshot = await getSnapshot(user);
  let offset = 0;
  if (cursor) {
    const sep = cursor.lastIndexOf(':');
    const parsed = Number(cursor.slice(sep + 1));
    if (Number.isFinite(parsed) && parsed > 0) offset = Math.floor(parsed);
  }
  const items = snapshot.feed.slice(offset, offset + FEED_PAGE_SIZE);
  const nextOffset = offset + items.length;
  return {
    items,
    nextCursor: nextOffset < snapshot.feed.length ? `${snapshot.builtAt}:${nextOffset}` : null,
  };
}

/** Drop the cached rails/feed so the next read recomposes — instant feedback
 * after an explicit like/dislike/not_interested. */
export async function invalidateRecommendations(userId: string): Promise<void> {
  await deleteCachedJson(CACHE_SCOPE, cacheSeed(userId));
}
