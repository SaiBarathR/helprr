import type { MediaImage } from './arr';

// Calendar Event (unified)
export type MovieReleaseType = 'cinema' | 'physical' | 'digital';
export type EpisodeFinaleType = 'series' | 'season' | 'midseason';

export interface CalendarEvent {
  id: string;
  instanceId?: string;
  instanceLabel?: string;
  type: 'episode' | 'movie' | 'album';
  title: string;
  subtitle: string;
  date: string;
  hasFile: boolean;
  monitored: boolean;
  seriesId?: number;
  movieId?: number;
  artistId?: number;
  albumId?: number;
  images: MediaImage[];
  releaseType?: MovieReleaseType;
  finaleType?: EpisodeFinaleType;
  /** `service` = Sonarr/Radarr/Lidarr; `scheduled` = user alert overlay */
  origin?: 'service' | 'scheduled';
  scheduledAlertId?: string;
  scheduledOccurrenceId?: string;
  releaseKind?: string;
  scheduleLabel?: string;
  notifyAt?: string;
  href?: string;
}
