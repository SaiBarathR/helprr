import type { WatchlistMediaType, WatchlistSource } from '@/lib/watchlist-helpers';

export type ScheduleMode = 'absolute' | 'release_relative';
/** Watchlist sources, plus Lidarr for music (album and artist alerts). */
export type AlertSource = WatchlistSource | 'LIDARR';
export type AlertMediaType = WatchlistMediaType | 'music';
export type AlertScope = 'movie' | 'series' | 'season' | 'episode' | 'anime' | 'album' | 'artist';
export type AlertStatus = 'active' | 'cancelled';
export type OccurrenceStatus = 'pending' | 'sent' | 'failed' | 'cancelled';
export type ReleaseKind = 'custom' | 'cinema' | 'digital' | 'physical' | 'episode' | 'season' | 'airing' | 'album';

export interface ScheduledAlertDraft {
  source: AlertSource;
  /** Music: the album id for an album alert, the artist id for an artist's-next-album alert. */
  externalId: string;
  mediaType: AlertMediaType;
  title: string;
  subtitle?: string | null;
  year?: number | null;
  posterUrl?: string | null;
  overview?: string | null;
  rating?: number | null;
  href?: string | null;
  instanceId?: string | null;
  releaseDate?: string | null;
  /** Scope-specific ids stored for resolver targeting */
  seasonNumber?: number | null;
  episodeId?: number | null;
  /** Set on a music draft for one album (an album alert); absent for an artist's next album. */
  albumId?: number | null;
}

export interface CreateScheduledAlertInput {
  draft: ScheduledAlertDraft;
  scheduleMode: ScheduleMode;
  scope: AlertScope;
  releaseTypes?: ReleaseKind[];
  offsetMinutes?: number;
  timeZone?: string;
  absoluteNotifyAt?: string | null;
}

export interface ScheduledAlertMetadata {
  seasonNumber?: number;
  episodeId?: number;
  seriesId?: number;
  movieId?: number;
  migratedFromWatchlist?: boolean;
  watchlistItemId?: string;
}

export interface OccurrenceCandidate {
  targetKey: string;
  releaseKind: ReleaseKind;
  releaseAt: Date | null;
  notifyAt: Date;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export interface PreviewResult {
  defaults: {
    scheduleMode: ScheduleMode;
    scope: AlertScope;
    releaseTypes: ReleaseKind[];
    offsetMinutes: number;
    absoluteNotifyAt: string | null;
  };
  candidates: OccurrenceCandidate[];
}

export interface ResolveResult {
  candidates: OccurrenceCandidate[];
  /** False when a required remote source failed and no fallback candidates were produced. */
  resolved: boolean;
}
