import type { RecMediaType } from './item-keys';

// Taste-profile payload stored in UserTasteProfile.profile (JSON). Bump
// PROFILE_VERSION whenever the shape changes so stale rows rebuild instead of
// misparse. All weights are already time-decayed at build time; readers treat
// the profile as immutable until the next rebuild.

export const PROFILE_VERSION = 2;

/** Genre → decayed affinity weight. Genre names are lowercase-normalized. */
export type GenreVector = Record<string, number>;

export type Daypart = 'morning' | 'afternoon' | 'evening' | 'night';

export interface MediaClassProfile {
  /** Positive genre affinity, normalized so the strongest genre is 1. */
  genres: GenreVector;
  /** Release-decade affinity ("1990".."2020"), normalized like genres. */
  decades: Record<string, number>;
  /** Weighted average runtime (minutes) of engaged titles, null when unknown. */
  typicalRuntimeMin: number | null;
  /** Total engagement mass behind this class (Σ decayed weights) — used to
   * decide whether this class has enough signal to drive rails. */
  signalMass: number;
}

export interface ProfileSeed {
  itemKey: string;
  mediaType: RecMediaType;
  tmdbId?: number;
  anilistId?: number;
  title: string;
  /** 0..1 — recency × frequency × watch-time blend; drives "Because you watched". */
  weight: number;
}

export interface MoodProfile {
  /** Play-count mass per daypart (weekday and weekend merged), normalized to 1. */
  dayparts: Record<Daypart, number>;
  /** Genre affinity conditioned on daypart — the "weeknight comfort" signal. */
  genresByDaypart: Partial<Record<Daypart, GenreVector>>;
  /** True when built from real Playback Reporting rows (vs LastPlayedDate fallback). */
  fromPlaybackReporting: boolean;
}

export interface NegativeSignals {
  /** Hard-excluded item keys (not_interested / dislike) — never expire. */
  excludedItemKeys: string[];
  /** Genre → penalty weight accumulated from dislikes/not_interested. */
  dislikedGenres: GenreVector;
}

export interface ImpressionFatigue {
  /** itemKey → decayed count of times shown without a click. */
  seenWithoutClick: Record<string, number>;
}

export interface TasteProfile {
  version: number;
  builtAt: string;
  /** Which signal sources actually contributed (for diagnostics + UI copy). */
  sources: {
    jellyfin: boolean;
    playbackReporting: boolean;
    anilist: boolean;
    watchlist: boolean;
    events: boolean;
  };
  movie: MediaClassProfile;
  tv: MediaClassProfile;
  anime: MediaClassProfile;
  moods: MoodProfile;
  negatives: NegativeSignals;
  fatigue: ImpressionFatigue;
  /** Top engaged titles, strongest first — capped small (they fan out TMDB calls). */
  seeds: ProfileSeed[];
  /** Item keys the user has fully watched (capped) — excluded from discovery rails. */
  watchedItemKeys: string[];
  /** Item keys boosted by explicit positive feedback (like / click-through). */
  likedItemKeys: string[];
  /** AniList media ids on the user's list (any status) — anime discovery skips
   * them so we never recommend something they're already watching/planning. */
  listedAnilistIds: number[];
}

export function emptyMediaClassProfile(): MediaClassProfile {
  return { genres: {}, decades: {}, typicalRuntimeMin: null, signalMass: 0 };
}

export function emptyTasteProfile(builtAt: string): TasteProfile {
  return {
    version: PROFILE_VERSION,
    builtAt,
    sources: { jellyfin: false, playbackReporting: false, anilist: false, watchlist: false, events: false },
    movie: emptyMediaClassProfile(),
    tv: emptyMediaClassProfile(),
    anime: emptyMediaClassProfile(),
    moods: { dayparts: { morning: 0, afternoon: 0, evening: 0, night: 0 }, genresByDaypart: {}, fromPlaybackReporting: false },
    negatives: { excludedItemKeys: [], dislikedGenres: {} },
    fatigue: { seenWithoutClick: {} },
    seeds: [],
    watchedItemKeys: [],
    likedItemKeys: [],
    listedAnilistIds: [],
  };
}
