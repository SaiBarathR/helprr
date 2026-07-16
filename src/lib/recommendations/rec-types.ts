import type { RecMediaType } from './item-keys';

// Wire + internal shapes for the recommendation engine. RecItem is what the
// UI renders (rails page, infinite feed, For You widget); Candidate is the
// scorer's input, one per title from any source.

export interface CandidateArrRef {
  scope: 'radarr' | 'sonarr';
  instanceId: string;
  id: number;
}

export interface CandidateWatchState {
  played: boolean;
  /** Movie resume progress 0–100. */
  progressPct?: number;
  watchedEpisodes?: number;
  totalEpisodes?: number;
}

export interface Candidate {
  itemKey: string;
  mediaType: RecMediaType;
  tmdbId?: number;
  anilistId?: number;
  title: string;
  year: number | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  /** 0–10 community rating when known. */
  rating: number | null;
  voteCount: number | null;
  popularity: number | null;
  runtimeMin: number | null;
  genres: string[];
  overview: string | null;
  /** Downloaded in Sonarr/Radarr (drives the owned badge + play-ready rails). */
  owned: boolean;
  arr?: CandidateArrRef;
  watch?: CandidateWatchState;
  href: string;
  source: 'library' | 'tmdb' | 'anilist';
  /** When the arr instance added this title (ISO) — drives "New in your library". */
  addedAt?: string | null;
  /** Seed titles that produced this candidate (for "Because you watched" copy). */
  seedTitles?: string[];
  /** Sum of seed weights that recommended this candidate (multi-seed items rank up). */
  seedBoost?: number;
}

export interface ScoredCandidate extends Candidate {
  score: number;
  /** True when this item filled an exploration slot (out-of-profile pick). */
  exploration?: boolean;
}

/** One rendered recommendation — Candidate minus scorer internals. */
export interface RecItem {
  itemKey: string;
  mediaType: RecMediaType;
  tmdbId?: number;
  anilistId?: number;
  title: string;
  year: number | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  rating: number | null;
  runtimeMin: number | null;
  genres: string[];
  overview: string | null;
  owned: boolean;
  arr?: CandidateArrRef;
  watch?: CandidateWatchState;
  href: string;
  source: 'library' | 'tmdb' | 'anilist';
  /** Short human reason ("Because you watched Severance", "Trending now"). */
  reason: string | null;
  exploration?: boolean;
  /** Netflix-style match confidence 60–99, only when the profile had enough
   * signal to be meaningful. Absent on unscored surfaces (continue watching,
   * new-in-library). */
  matchPct?: number;
}

export interface RecommendationRail {
  /** Stable id, also the events railId ("top-picks", "because:tmdb:tv:1399"). */
  id: string;
  title: string;
  /** Optional subtitle/explanation. */
  reason: string | null;
  items: RecItem[];
}

export interface RecommendationsResponse {
  rails: RecommendationRail[];
  /** Which signal sources fed the profile (drives empty-state / setup hints). */
  sources: {
    jellyfin: boolean;
    playbackReporting: boolean;
    anilist: boolean;
    watchlist: boolean;
    events: boolean;
  };
  profileBuiltAt: string;
}

export interface FeedResponse {
  items: RecItem[];
  nextCursor: string | null;
}
