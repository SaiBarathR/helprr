import { normalizeGenre } from './build-profile';
import { daypartOf } from './build-profile';
import type { Daypart, GenreVector, TasteProfile } from './profile-types';
import {
  genreAffinity,
  hashSeed,
  scoreCandidates,
  seededRng,
  selectRailItems,
} from './score';
import type { Candidate, RecItem, RecommendationRail, ScoredCandidate } from './rec-types';

// Rails + feed composition: pure given pre-fetched candidates and the profile.
// Deterministic for a fixed (profile, candidates, rngSeed) so cached rails are
// stable across a session and pagination never shifts under the user.

const RAIL_LIMIT = 20;
const BECAUSE_RAIL_LIMIT = 15;
const MAX_BECAUSE_RAILS = 3;
const MIN_RAIL_ITEMS = 4;
const FEED_LENGTH = 200;

/** Netflix-style match percentage from the raw score. The mapping is honest
 * about its floor: anything under ~0.35 has no meaningful profile evidence
 * and shows no badge rather than a fabricated number. */
function matchPercent(score: number): number | undefined {
  if (score <= 0.35) return undefined;
  return Math.min(99, Math.max(60, Math.round(55 + score * 12)));
}

function toRecItem(scored: ScoredCandidate, reason: string | null): RecItem {
  return {
    itemKey: scored.itemKey,
    mediaType: scored.mediaType,
    tmdbId: scored.tmdbId,
    anilistId: scored.anilistId,
    title: scored.title,
    year: scored.year,
    posterUrl: scored.posterUrl,
    backdropUrl: scored.backdropUrl,
    rating: scored.rating,
    runtimeMin: scored.runtimeMin,
    genres: scored.genres,
    overview: scored.overview,
    owned: scored.owned,
    arr: scored.arr,
    watch: scored.watch,
    href: scored.href,
    source: scored.source,
    reason,
    exploration: scored.exploration,
    matchPct: matchPercent(scored.score),
  };
}

function itemReason(scored: ScoredCandidate): string | null {
  if (scored.exploration) return 'Something different';
  if (scored.seedTitles?.length) return `Because you watched ${scored.seedTitles[0]}`;
  return null;
}

const MOOD_CLUSTERS: Array<{ label: string; genres: string[] }> = [
  { label: 'comfort watches', genres: ['comedy', 'family', 'animation', 'sitcom'] },
  { label: 'edge-of-your-seat picks', genres: ['thriller', 'crime', 'mystery', 'horror'] },
  { label: 'big adventures', genres: ['action', 'adventure', 'science fiction', 'sci-fi & fantasy', 'fantasy', 'action & adventure'] },
  { label: 'all the feels', genres: ['drama', 'romance'] },
  { label: 'something real', genres: ['documentary', 'history', 'war'] },
];

function moodLabel(vector: GenreVector): string | null {
  let best: { label: string; weight: number } | null = null;
  for (const cluster of MOOD_CLUSTERS) {
    const weight = cluster.genres.reduce((sum, g) => sum + (vector[g] ?? 0), 0);
    if (weight > 0 && (!best || weight > best.weight)) best = { label: cluster.label, weight };
  }
  return best?.label ?? null;
}

const DAYPART_TITLES: Record<Daypart, string> = {
  morning: 'Your morning',
  afternoon: 'Your afternoon',
  evening: 'Tonight',
  night: 'Late night',
};

export interface ComposeInput {
  profile: TasteProfile;
  library: Candidate[];
  discovery: Candidate[];
  anime: Candidate[];
  continueWatching: RecItem[];
  watchlistItemKeys: Set<string>;
  /** All-time hard-excluded keys read live (a not_interested must vanish NOW,
   * not after the next profile rebuild). */
  liveExcludedItemKeys: Set<string>;
  /** Liked keys read live — a fresh "More like this" boosts on the very next
   * compose instead of waiting out the profile's 6h staleness. */
  liveLikedItemKeys?: Set<string>;
  now: Date;
  /** Current hour 0-23 in the user's timezone (drives the mood rail). */
  localHour: number;
  rngSeed: string;
}

function withLiveFeedback(
  profile: TasteProfile,
  liveExcluded: Set<string>,
  liveLiked: Set<string> | undefined
): TasteProfile {
  if (liveExcluded.size === 0 && !liveLiked?.size) return profile;
  const excluded = new Set([...profile.negatives.excludedItemKeys, ...liveExcluded]);
  const liked = new Set([...profile.likedItemKeys, ...(liveLiked ?? [])]);
  return {
    ...profile,
    negatives: { ...profile.negatives, excludedItemKeys: [...excluded] },
    likedItemKeys: [...liked],
  };
}

export interface ComposedRecommendations {
  rails: RecommendationRail[];
  feed: RecItem[];
}

export function composeRecommendations(input: ComposeInput): ComposedRecommendations {
  const profile = withLiveFeedback(input.profile, input.liveExcludedItemKeys, input.liveLikedItemKeys);
  const rng = seededRng(hashSeed(input.rngSeed));
  const rails: RecommendationRail[] = [];
  const watchlistItemKeys = input.watchlistItemKeys;

  const scoredLibrary = scoreCandidates(input.library, { profile, watchlistItemKeys });
  const scoredDiscovery = scoreCandidates(input.discovery, { profile, watchlistItemKeys });
  const scoredAnime = scoreCandidates(input.anime, { profile, watchlistItemKeys });

  const pushRail = (id: string, title: string, reason: string | null, items: ScoredCandidate[], reasonFor = itemReason) => {
    if (items.length < MIN_RAIL_ITEMS) return;
    rails.push({ id, title, reason, items: items.map((s) => toRecItem(s, reasonFor(s))) });
  };

  // 1. Continue watching — straight from Jellyfin resume, no scoring.
  if (input.continueWatching.length > 0) {
    rails.push({
      id: 'continue-watching',
      title: 'Continue watching',
      reason: null,
      items: input.continueWatching,
    });
  }

  // 2. Top picks — owned, unwatched, best profile match.
  pushRail(
    'top-picks',
    'Top picks for you',
    'On your server, matched to your taste',
    selectRailItems(scoredLibrary, { limit: RAIL_LIMIT, rng, profile })
  );

  // 3. Because-you-watched rails from the strongest seeds. Dedupe by title —
  // one title engaged via both Jellyfin and AniList is still one seed.
  let becauseRails = 0;
  const becauseSeedTitles = new Set<string>();
  for (const seed of profile.seeds) {
    if (becauseRails >= MAX_BECAUSE_RAILS) break;
    if (becauseSeedTitles.has(seed.title)) continue;
    becauseSeedTitles.add(seed.title);
    const fromSeed = scoredDiscovery.filter((c) => c.seedTitles?.includes(seed.title));
    if (fromSeed.length < MIN_RAIL_ITEMS) continue;
    pushRail(
      `because:${seed.itemKey}`,
      `Because you watched ${seed.title}`,
      null,
      selectRailItems(fromSeed, { limit: BECAUSE_RAIL_LIMIT, rng, profile, explorationRatio: 0 }),
      () => null
    );
    becauseRails += 1;
  }

  // 4. Mood rail for the current daypart.
  const daypart = daypartOf(input.localHour);
  const daypartVector = profile.moods.genresByDaypart[daypart];
  if (daypartVector && Object.keys(daypartVector).length > 0) {
    const mood = moodLabel(daypartVector);
    const boosted = [...scoredLibrary, ...scoredDiscovery]
      .map((c) => ({ ...c, score: c.score + 1.5 * genreAffinity(c.genres, daypartVector) }))
      .filter((c) => genreAffinity(c.genres, daypartVector) > 0.15)
      .sort((a, b) => b.score - a.score);
    const topDaypartGenres = Object.keys(daypartVector).slice(0, 2);
    pushRail(
      `mood:${daypart}`,
      mood ? `${DAYPART_TITLES[daypart]}: ${mood}` : `${DAYPART_TITLES[daypart]} picks`,
      topDaypartGenres.length
        ? `You usually go for ${topDaypartGenres.join(' and ')} around this time`
        : null,
      selectRailItems(boosted, { limit: BECAUSE_RAIL_LIMIT, rng, profile, explorationRatio: 0 }),
      () => null
    );
  }

  // 5. Genre rails from the two strongest overall genres (movie + tv merged).
  const mergedGenres: GenreVector = {};
  for (const [g, w] of Object.entries(profile.movie.genres)) mergedGenres[g] = Math.max(mergedGenres[g] ?? 0, w);
  for (const [g, w] of Object.entries(profile.tv.genres)) mergedGenres[g] = Math.max(mergedGenres[g] ?? 0, w);
  const topGenreNames = Object.entries(mergedGenres)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .filter(([, w]) => w >= 0.5)
    .map(([g]) => g);
  for (const genre of topGenreNames) {
    const inGenre = [...scoredLibrary, ...scoredDiscovery].filter((c) =>
      c.genres.some((g) => normalizeGenre(g) === genre)
    ).sort((a, b) => b.score - a.score);
    const display = genre.replace(/\b\w/g, (ch) => ch.toUpperCase());
    pushRail(
      `genre:${genre}`,
      `${display} you'll like`,
      null,
      selectRailItems(inGenre, { limit: BECAUSE_RAIL_LIMIT, rng, profile, explorationRatio: 0.1 }),
      (s) => (s.exploration ? 'Something different' : null)
    );
  }

  // 6. Discover — not on the server yet, spans trending + genre discovery.
  pushRail(
    'discover',
    'Discover: worth requesting',
    'Not on your server yet',
    selectRailItems(scoredDiscovery, { limit: RAIL_LIMIT, rng, profile, explorationRatio: 0.15 })
  );

  // 7. Anime — only when the user has real anime signal.
  if (profile.anime.signalMass > 1 && scoredAnime.length >= MIN_RAIL_ITEMS) {
    pushRail(
      'anime-for-you',
      'Anime for you',
      null,
      selectRailItems(scoredAnime, { limit: BECAUSE_RAIL_LIMIT, rng, profile, explorationRatio: 0.1 })
    );
  }

  // 8. New in library — recency-ordered, unwatched, no scoring.
  const excluded = new Set(profile.negatives.excludedItemKeys);
  const newInLibrary = input.library
    .filter((c) => c.addedAt && !c.watch?.played && !excluded.has(c.itemKey))
    .sort((a, b) => Date.parse(b.addedAt ?? '') - Date.parse(a.addedAt ?? ''))
    .slice(0, BECAUSE_RAIL_LIMIT)
    .map((c) => toRecItem({ ...c, score: 0 }, null));
  if (newInLibrary.length >= MIN_RAIL_ITEMS) {
    rails.push({ id: 'new-in-library', title: 'New on your server', reason: null, items: newInLibrary });
  }

  // 9. Watchlist titles that are downloaded and ready.
  const watchlistReady = scoredLibrary.filter((c) => watchlistItemKeys.has(c.itemKey));
  pushRail(
    'watchlist-ready',
    'From your watchlist, ready to watch',
    null,
    watchlistReady.slice(0, BECAUSE_RAIL_LIMIT),
    () => null
  );

  // ── Infinite feed: one blended, deterministic stream over every pool. ──────
  const feed = buildFeed([...scoredLibrary, ...scoredDiscovery, ...scoredAnime], rng);

  return { rails, feed };
}

/** Variety bucket a feed item competes in: its strongest seed, else its pool. */
function feedReasonOf(candidate: ScoredCandidate): string {
  return candidate.seedTitles?.[0] ?? (candidate.owned ? 'library' : candidate.source);
}

/**
 * Rank-biased sampling without replacement: mostly picks near the top of the
 * score-sorted pool but keeps reaching down the tail, so the feed starts
 * exploitation-heavy and stays varied for hundreds of items. A same-reason
 * run cap keeps it from reading as "12 in a row because you watched X" —
 * after two consecutive items from one seed/pool, the next pick skips ahead
 * to a different reason.
 */
function buildFeed(scored: ScoredCandidate[], rng: () => number): RecItem[] {
  const pool = [...scored].sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const feed: RecItem[] = [];
  let lastReason: string | null = null;
  let reasonRun = 0;
  while (feed.length < FEED_LENGTH && pool.length > 0) {
    // Geometric pick over the sorted remainder (p≈0.18 → E[idx]≈4.5).
    let idx = 0;
    while (idx < pool.length - 1 && rng() > 0.18) idx += 1;
    if (reasonRun >= 2 && lastReason !== null) {
      const scanLimit = Math.min(pool.length, idx + 30);
      for (let j = idx; j < scanLimit; j++) {
        if (feedReasonOf(pool[j]) !== lastReason) {
          idx = j;
          break;
        }
      }
    }
    const [chosen] = pool.splice(Math.min(idx, pool.length - 1), 1);
    if (seen.has(chosen.itemKey)) continue;
    seen.add(chosen.itemKey);
    const reason = feedReasonOf(chosen);
    reasonRun = reason === lastReason ? reasonRun + 1 : 1;
    lastReason = reason;
    feed.push(toRecItem(chosen, itemReason(chosen)));
  }
  return feed;
}
