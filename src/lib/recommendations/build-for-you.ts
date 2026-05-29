import type { TmdbListItem } from '@/lib/tmdb-client';
import type { ForYouItem } from './types';

/**
 * Seed used to compute recommendations.
 *
 * `weight` is a 0..1 multiplier — recent seeds get higher weight so
 * recommendations from "what you just added" rank above older library
 * entries. `mediaType` lets us tag the reason with the matching media type.
 */
export interface Seed {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  weight: number;
}

interface BuildInput {
  seeds: Seed[];
  /**
   * Pre-fetched recommendations per seed, indexed by `${mediaType}:${tmdbId}`.
   * When a seed has no entry, it's silently skipped (treated as a fetch
   * failure that we already absorbed at the API layer).
   */
  recommendationsBySeed: Map<string, TmdbListItem[]>;
  /**
   * Keys (`${mediaType}:${tmdbId}`) of titles already in the user's
   * Sonarr/Radarr library. Keyed by media type because TMDB's movie and TV id
   * namespaces overlap — a movie #1399 must not suppress an unrelated TV #1399.
   */
  libraryKeys: Set<string>;
  /** Keys (`${mediaType}:${tmdbId}`) of titles in the watchlist. */
  watchlistKeys: Set<string>;
  /** Cap on returned items. */
  limit: number;
}

const TMDB_POSTER_BASE = 'https://image.tmdb.org/t/p/w500';

function seedKey(seed: Pick<Seed, 'mediaType' | 'tmdbId'>): string {
  return `${seed.mediaType}:${seed.tmdbId}`;
}

function toYear(item: TmdbListItem, mediaType: 'movie' | 'tv'): number | null {
  const raw = mediaType === 'movie' ? item.release_date : item.first_air_date;
  if (!raw) return null;
  const n = Number(raw.slice(0, 4));
  return Number.isFinite(n) ? n : null;
}

function itemTitle(item: TmdbListItem, mediaType: 'movie' | 'tv'): string {
  return mediaType === 'movie' ? (item.title ?? '') : (item.name ?? '');
}

function detailHref(mediaType: 'movie' | 'tv', id: number): string {
  return mediaType === 'movie' ? `/discover/movie/${id}` : `/discover/tv/${id}`;
}

/**
 * Pure aggregator: given seeds and their TMDB recommendations, produce a
 * ranked, deduped, library-filtered list of titles to recommend.
 *
 * Scoring rationale: each recommendation accumulates seed weight + a small
 * fractional kicker for TMDB's `vote_average` (so two titles that come from
 * the same seed are ordered by quality). Items that show up from MULTIPLE
 * seeds rank highest, which is what we want — they're "the kind of thing
 * the user keeps engaging with."
 */
export function buildForYou(input: BuildInput): ForYouItem[] {
  const { seeds, recommendationsBySeed, libraryKeys, watchlistKeys, limit } = input;

  const accumulator = new Map<
    string,
    {
      item: TmdbListItem;
      mediaType: 'movie' | 'tv';
      score: number;
      reason: string;
      // Weight of the seed that produced `reason`, so a later, higher-weight
      // seed can relabel the item to credit the strongest contributor.
      reasonWeight: number;
    }
  >();

  for (const seed of seeds) {
    const recs = recommendationsBySeed.get(seedKey(seed)) ?? [];
    for (const rec of recs) {
      if (!rec.id) continue;

      const key = `${seed.mediaType}:${rec.id}`;
      if (libraryKeys.has(key)) continue;
      if (watchlistKeys.has(key)) continue;

      const vote = typeof rec.vote_average === 'number' ? rec.vote_average : 0;
      const contribution = seed.weight + Math.min(0.1, vote / 100);

      const existing = accumulator.get(key);
      if (existing) {
        existing.score += contribution;
        if (seed.weight > existing.reasonWeight) {
          existing.reason = `Like ${seed.title}`;
          existing.reasonWeight = seed.weight;
        }
      } else {
        accumulator.set(key, {
          item: rec,
          mediaType: seed.mediaType,
          score: contribution,
          reason: `Like ${seed.title}`,
          reasonWeight: seed.weight,
        });
      }
    }
  }

  return [...accumulator.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item, mediaType, reason }) => ({
      id: item.id,
      tmdbId: item.id,
      mediaType,
      title: itemTitle(item, mediaType),
      year: toYear(item, mediaType),
      posterPath: item.poster_path ? `${TMDB_POSTER_BASE}${item.poster_path}` : null,
      rating: typeof item.vote_average === 'number' ? item.vote_average : 0,
      overview: item.overview ?? '',
      reason,
      href: detailHref(mediaType, item.id),
    }));
}
