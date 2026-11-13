import type { WatchlistMediaType, WatchlistSource } from '@/lib/watchlist-helpers';

export type ScheduleMode = 'absolute' | 'release_relative';
/** Watchlist sources, plus Lidarr for music (album and artist alerts). */
export type AlertSource = WatchlistSource | 'LIDARR';
export type AlertMediaType = WatchlistMediaType | 'music';
export type AlertScope = 'movie' | 'series' | 'season' | 'episode' | 'anime' | 'album' | 'artist';
export type AlertStatus = 'active' | 'cancelled';
export type OccurrenceStatus = 'pending' | 'sent' | 'failed' | 'cancelled';
export type ReleaseKind = 'custom' | 'cinema' | 'digital' | 'physical' | 'episode' | 'season' | 'airing' | 'album';
/** What a release reminder was asked for that is already out, so it could never go off. */
export type ReleasedKind = 'album' | 'movie' | 'episode';

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
  /** Artist alerts: the albums ahead already seen ("instanceId:albumId"), so only new ones are announced. */
  knownAlbumKeys?: string[];
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
  /** The album, film or episode is already out, so only a custom date can remind. */
  released?: ReleasedKind;
}

/** An album ahead that an artist alert found, however far off its release is. */
export interface UpcomingAlbum {
  key: string;
  title: string;
  artistName: string;
  releaseAt: Date;
}

export interface ResolveResult {
  candidates: OccurrenceCandidate[];
  /** False when a required remote source failed and no fallback candidates were produced. */
  resolved: boolean;
  /** Artist alerts only: every album ahead Lidarr knows of, for the "new album" announcement. */
  upcomingAlbums?: UpcomingAlbum[];
  /** Album, film or episode alerts: it is already out, so a release reminder on it can never go off. */
  released?: ReleasedKind;
}
