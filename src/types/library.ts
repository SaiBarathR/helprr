import type { MediaImage } from './arr';
import type { LidarrArtist } from './lidarr';
import type { SonarrSeries } from './sonarr';

// Wanted Responses
export interface WantedMissingRecord {
  source: 'sonarr' | 'radarr' | 'lidarr';
  mediaType: 'episode' | 'movie' | 'album';
  id: number;
  title?: string;
  // Sonarr episode fields
  seriesId?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  airDateUtc?: string;
  series?: SonarrSeries;
  // Radarr movie fields
  year?: number;
  added?: string;
  monitored?: boolean;
  hasFile?: boolean;
  images?: MediaImage[];
  // Lidarr album fields
  artistId?: number;
  albumId?: number;
  releaseDate?: string;
  artist?: LidarrArtist;
}

export interface WantedResponse {
  page: number;
  pageSize: number;
  totalRecords: number;
  records: WantedMissingRecord[];
}

// Library Gaps page — episode/season targets carry arrays because gaps are
// grouped per show (20 overdue episodes of one series = one card, one target).
export type LibraryGapSearchTarget =
  | { kind: 'episodes'; episodeIds: number[]; instanceId: string }
  | { kind: 'seasons'; sonarrSeriesId: number; seasonNumbers: number[]; instanceId: string }
  | { kind: 'movie'; radarrMovieId: number; instanceId: string }
  | { kind: 'none' };

export interface LibraryGapItem {
  key: string;
  title: string;
  subtitle?: string;
  date?: string; // ISO; rendered as relative time client-side
  year?: number;
  poster: string | null;
  href?: string;
  search: LibraryGapSearchTarget;
  collectionTitle?: string;
  tmdbId?: number;
  collectionTmdbId?: number; // TMDB collection id — links a collection-gap card to its collection page
}

export type LibraryGapSectionId = 'missingSeasons' | 'newUpcoming' | 'collectionGaps' | 'overdue' | 'notReleased';

export interface LibraryGapSection {
  id: LibraryGapSectionId;
  count: number; // true total of searchable units (seasons/episodes/movies) — may exceed what the shown items cover when truncated
  items: LibraryGapItem[];
  available: boolean; // false when the backing service is unconfigured or its fetch failed
  error?: boolean; // true when the service is configured but the fetch failed (vs. simply not connected)
}

// Owned-vs-total across the monitored library, surfaced as the Insights completeness gauge.
// Units mix TV episodes and movies (episodes dominate by volume); the tv/movies split keeps
// the blended `percent` honest. Omitted when nothing monitored, so consumers must null-check.
export interface LibraryCompleteness {
  percent: number; // 0..100, rounded — overall
  ownedUnits: number;
  totalUnits: number;
  tv: { owned: number; total: number };
  movies: { owned: number; total: number };
}

export interface LibraryGapsResponse {
  sections: LibraryGapSection[];
  completeness?: LibraryCompleteness; // omitted when no monitored units exist
}

// Random watch — one downloaded movie/series drawn from the Radarr/Sonarr
// pools by /api/random-watch. Shared by the page and the dashboard widget.
export type RandomWatchFilterType = 'any' | 'movie' | 'series';

export interface RandomPick {
  mediaType: 'movie' | 'series';
  id: number;
  instanceId: string | null;
  title: string;
  year: number | null;
  overview: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  runtime: number | null;
  genres: string[];
  href: string;
  rating: number | null;
}
