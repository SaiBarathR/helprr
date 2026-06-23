// Jellyfin watch-status overlay — shared shapes + alias-key helpers.
//
// Sonarr/Radarr have no "watched" concept; Jellyfin is the source of truth. The
// server matches arr items to Jellyfin by provider id and returns ONE map whose
// values are addressable by several alias-key formats, because each UI surface
// holds a different identifier:
//   • detail pages / discover → provider ids   (tmdb:550, tvdb:81189, imdb:tt…)
//   • list/grid/table cards   → arr id+instance (radarr:<instanceId>:<id>)
//   • AniList browse rails     → anilist media id (anilist:<mediaId>)
//
// This file is import-safe from both client and server (types + pure functions).

export interface MovieWatchStatus {
  kind: 'movie';
  jellyfinItemId: string;
  played: boolean;
  /** Resume progress 0–100 (0 when unstarted, 100 when played). */
  playedPercentage: number;
}

export interface SeriesWatchStatus {
  kind: 'series';
  jellyfinItemId: string;
  /** Whole series watched (every leaf episode Jellyfin holds). */
  played: boolean;
  watchedEpisodeCount: number;
  totalEpisodeCount: number;
}

export type WatchStatus = MovieWatchStatus | SeriesWatchStatus;

export type WatchKind = WatchStatus['kind'];

/** Single source of truth for "fully watched" — shared by the overlay badges and
 * the mark-watched menu so the displayed state and the toggle can never disagree.
 * Jellyfin's own `played` flag is authoritative (it accounts for every leaf
 * episode, specials included); the count comparison is an equivalent fallback. */
export function isFullyWatched(status: WatchStatus): boolean {
  if (status.kind === 'movie') return status.played;
  return status.played || (status.totalEpisodeCount > 0 && status.watchedEpisodeCount >= status.totalEpisodeCount);
}

/**
 * De-duplicated wire format: each status object appears once in `items`; `keys`
 * maps every alias to its index. Keeps the payload small when an item carries
 * 2–3 aliases (provider + arr-id + anilist).
 */
export interface WatchStatusMapResponse {
  linked: boolean;
  items: WatchStatus[];
  keys: Record<string, number>;
}

export interface EpisodeWatchStatus {
  /** Jellyfin item id for this episode — lets the episode page toggle watched state. */
  jellyfinItemId: string;
  played: boolean;
  /** Resume progress 0–100. */
  playedPercentage: number;
}

export interface SeriesEpisodesResponse {
  linked: boolean;
  /** Whether the series resolved to a Jellyfin item at all. */
  found: boolean;
  jellyfinSeriesId: string | null;
  /** Per-episode status keyed `S{season}E{episode}` (see {@link episodeKey}). */
  episodes: Record<string, EpisodeWatchStatus>;
}

export type ProviderName = 'tmdb' | 'tvdb' | 'imdb';
export type ArrScope = 'sonarr' | 'radarr';

// Provider keys are namespaced by media kind because TMDB uses INDEPENDENT id
// spaces for movies vs TV — a movie and a series can share the same numeric
// tmdbId. Without the kind prefix they'd collide in the flat key map (and a
// movie lookup could resolve to a series, driving a wrong write-back).
export const providerKey = (kind: WatchKind, provider: ProviderName, id: string | number): string =>
  `${kind}:${provider}:${String(id).toLowerCase()}`;

export const arrKey = (scope: ArrScope, instanceId: string, id: number): string =>
  `${scope}:${instanceId}:${id}`;

export const anilistKey = (mediaId: number): string => `anilist:${mediaId}`;

export const episodeKey = (season: number, episode: number): string => `S${season}E${episode}`;
