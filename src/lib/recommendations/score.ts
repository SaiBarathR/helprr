import { normalizeGenre } from './build-profile';
import type { GenreVector, MediaClassProfile, TasteProfile } from './profile-types';
import type { Candidate, ScoredCandidate } from './rec-types';

// Pure scoring + rail selection. No I/O, no Math.random — randomness comes
// from an injected seeded RNG so a given (profile, candidates, seed) triple
// always produces the same rails (stable pagination, testable output).

/** Mean profile affinity across the candidate's genres, 0..1. */
export function genreAffinity(genres: string[], vector: GenreVector): number {
  if (genres.length === 0) return 0;
  let sum = 0;
  for (const g of genres) sum += vector[normalizeGenre(g)] ?? 0;
  return sum / genres.length;
}

function decadeAffinity(year: number | null, profile: MediaClassProfile): number {
  if (!year || year < 1900) return 0;
  return profile.decades[String(Math.floor(year / 10) * 10)] ?? 0;
}

/** Community rating dampened when the vote base is thin. */
export function qualityPrior(rating: number | null, voteCount: number | null): number {
  if (rating == null || rating <= 0) return 0;
  // /100: an 8.0 with 60 votes (event special, niche filler) earns roughly
  // half the credit of a 7.0 with a real audience.
  const confidence = voteCount == null ? 0.5 : Math.min(1, voteCount / 100);
  return (Math.min(10, rating) / 10) * confidence;
}

function popularityPrior(popularity: number | null): number {
  if (popularity == null || popularity <= 0) return 0;
  return Math.min(1, Math.log10(1 + popularity) / 3); // ~1 at popularity 1000
}

export interface ScoringContext {
  profile: TasteProfile;
  /** Extra boost applied to owned watchlist titles (they asked for it and have it). */
  watchlistItemKeys?: Set<string>;
}

const WEIGHTS = {
  genre: 2.2,
  quality: 0.5,
  popularity: 0.25,
  decade: 0.3,
  seed: 1.2,
  liked: 0.5,
  watchlist: 0.6,
  dislikedGenre: -0.9,
  fatiguePerImpression: -0.25,
} as const;

const FATIGUE_CAP = -1.2;

export function scoreCandidate(candidate: Candidate, ctx: ScoringContext): number {
  const { profile } = ctx;
  const classProfile = profile[candidate.mediaType];

  let score = 0;
  score += WEIGHTS.genre * genreAffinity(candidate.genres, classProfile.genres);
  score += WEIGHTS.quality * qualityPrior(candidate.rating, candidate.voteCount);
  score += WEIGHTS.popularity * popularityPrior(candidate.popularity);
  score += WEIGHTS.decade * decadeAffinity(candidate.year, classProfile);
  if (candidate.seedBoost) score += WEIGHTS.seed * Math.min(1.5, candidate.seedBoost);
  if (profile.likedItemKeys.includes(candidate.itemKey)) score += WEIGHTS.liked;
  if (ctx.watchlistItemKeys?.has(candidate.itemKey) && candidate.owned) score += WEIGHTS.watchlist;

  score += WEIGHTS.dislikedGenre * genreAffinity(candidate.genres, profile.negatives.dislikedGenres);
  const fatigue = profile.fatigue.seenWithoutClick[candidate.itemKey];
  if (fatigue) score += Math.max(FATIGUE_CAP, WEIGHTS.fatiguePerImpression * fatigue);

  return score;
}

export interface ScoreAllOptions extends ScoringContext {
  /** Fully-watched keys to drop (skip for continue-watching/rewatch rails). */
  excludeWatched?: boolean;
}

/** Score candidates, dropping hard-excluded (not_interested/dislike) and, by
 * default, fully-watched titles. */
export function scoreCandidates(candidates: Candidate[], options: ScoreAllOptions): ScoredCandidate[] {
  const excluded = new Set(options.profile.negatives.excludedItemKeys);
  const watched = options.excludeWatched === false ? null : new Set(options.profile.watchedItemKeys);
  const out: ScoredCandidate[] = [];
  for (const candidate of candidates) {
    if (excluded.has(candidate.itemKey)) continue;
    if (watched?.has(candidate.itemKey)) continue;
    if (candidate.watch?.played) continue;
    out.push({ ...candidate, score: scoreCandidate(candidate, options) });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** mulberry32 — tiny deterministic PRNG for exploration-slot placement. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface SelectRailOptions {
  limit: number;
  /** Fraction of slots reserved for out-of-profile exploration picks (default 0.12). */
  explorationRatio?: number;
  rng: () => number;
  profile: TasteProfile;
}

/**
 * Coarse franchise fingerprint: first meaningful title word with numerals and
 * sequel markers stripped, so "WrestleMania 37: Night 1" / "WWE WrestleMania
 * XXIV" and "Star Trek Beyond" / "Star Trek: The Motion Picture" collide.
 * False positives are fine — this only damps repeats inside one rail, it
 * never excludes.
 */
export function franchiseKey(title: string): string {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .filter((w) => !/^\d+$/.test(w) && !/^[ivxl]{1,5}$/.test(w)) // numbers + roman numerals
    .filter((w) => !['the', 'a', 'an', 'wwe'].includes(w));
  return words[0] ?? title.toLowerCase();
}

/**
 * Greedy diversity-aware selection: walk the score-sorted list, damping each
 * candidate by how often its lead genre was already picked (soft MMR — a rail
 * of 10 near-identical thrillers scores worse than 7 thrillers + 3 adjacents).
 * Exploration slots are filled with high-quality LOW-affinity titles and
 * spliced at seeded-random positions past the first three (the top of a rail
 * stays exploitation), tagged so events can measure them per rail.
 */
export function selectRailItems(scored: ScoredCandidate[], options: SelectRailOptions): ScoredCandidate[] {
  const { limit, rng, profile } = options;
  const explorationRatio = options.explorationRatio ?? 0.12;
  const explorationSlots = Math.min(Math.floor(limit * explorationRatio), Math.max(0, limit - 3));

  const leadGenreCounts = new Map<string, number>();
  const franchiseCounts = new Map<string, number>();
  const picked: ScoredCandidate[] = [];
  const remaining = [...scored];

  while (picked.length < limit - explorationSlots && remaining.length > 0) {
    let bestIdx = 0;
    let bestEffective = -Infinity;
    // Only the head of the list matters; capping the scan keeps this O(n·k).
    const scan = Math.min(remaining.length, 40);
    for (let i = 0; i < scan; i++) {
      const lead = normalizeGenre(remaining[i].genres[0] ?? '');
      const repeats = lead ? leadGenreCounts.get(lead) ?? 0 : 0;
      const franchiseRepeats = franchiseCounts.get(franchiseKey(remaining[i].title)) ?? 0;
      // Genre repeats damp softly; franchise repeats hard (a rail of five
      // WrestleManias or three Star Treks reads as broken).
      const effective = remaining[i].score * Math.pow(0.85, repeats) * Math.pow(0.4, franchiseRepeats);
      if (effective > bestEffective) {
        bestEffective = effective;
        bestIdx = i;
      }
    }
    const [chosen] = remaining.splice(bestIdx, 1);
    const lead = normalizeGenre(chosen.genres[0] ?? '');
    if (lead) leadGenreCounts.set(lead, (leadGenreCounts.get(lead) ?? 0) + 1);
    const franchise = franchiseKey(chosen.title);
    franchiseCounts.set(franchise, (franchiseCounts.get(franchise) ?? 0) + 1);
    picked.push(chosen);
  }

  if (explorationSlots > 0) {
    const pickedKeys = new Set(picked.map((c) => c.itemKey));
    const classVectors = profile;
    const explorers = remaining
      .filter((c) => !pickedKeys.has(c.itemKey))
      .filter((c) => genreAffinity(c.genres, classVectors[c.mediaType].genres) < 0.25)
      .filter((c) => qualityPrior(c.rating, c.voteCount) >= 0.55)
      .sort((a, b) => qualityPrior(b.rating, b.voteCount) - qualityPrior(a.rating, a.voteCount))
      .slice(0, explorationSlots)
      .map((c) => ({ ...c, exploration: true as const }));
    for (const explorer of explorers) {
      const pos = 3 + Math.floor(rng() * Math.max(1, picked.length - 2));
      picked.splice(Math.min(pos, picked.length), 0, explorer);
    }
  }

  return picked.slice(0, limit);
}
