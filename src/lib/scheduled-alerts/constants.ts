import type { AlertScope, ReleaseKind, ReleasedKind, ScheduleMode, ScheduledAlertDraft } from '@/lib/scheduled-alerts/types';

export const SCHEDULE_MODES: ScheduleMode[] = ['absolute', 'release_relative'];
export const ALERT_SCOPES: AlertScope[] = ['movie', 'series', 'season', 'episode', 'anime', 'album', 'artist'];
export const RELEASE_KINDS: ReleaseKind[] = ['custom', 'cinema', 'digital', 'physical', 'episode', 'season', 'airing', 'album'];

export const DEFAULT_OFFSET_MINUTES = 60;
export const DEFAULT_HORIZON_DAYS = 90;
export const MAX_REMINDER_ATTEMPTS = 5;

export const RELEASE_KIND_LABELS: Record<ReleaseKind, string> = {
  custom: 'Custom reminder',
  cinema: 'Cinema release',
  digital: 'Digital release',
  physical: 'Physical release',
  episode: 'Episode',
  season: 'Season',
  airing: 'Next airing',
  album: 'Album release',
};

export function defaultScopeForMediaType(mediaType: string): AlertScope {
  if (mediaType === 'movie') return 'movie';
  if (mediaType === 'anime') return 'anime';
  if (mediaType === 'music') return 'artist';
  return 'series';
}

export function defaultScopeForDraft(draft: Pick<ScheduledAlertDraft, 'mediaType' | 'seasonNumber' | 'episodeId' | 'albumId'>): AlertScope {
  if (draft.mediaType === 'movie') return 'movie';
  if (draft.mediaType === 'anime') return 'anime';
  if (draft.mediaType === 'music') return draft.albumId != null ? 'album' : 'artist';
  if (draft.episodeId != null) return 'episode';
  if (draft.seasonNumber != null) return 'season';
  return 'series';
}

const RELEASED_WHAT: Record<ReleasedKind, string> = {
  album: 'This album is already out',
  movie: 'This movie is already out',
  episode: 'This episode has already aired',
};

const DUE_WHAT: Record<ReleasedKind, string> = {
  album: 'This album comes out',
  movie: 'This movie comes out',
  episode: 'This episode airs',
};

/** The save's refusal of a release reminder that could never go off: already out, or due sooner than its notice. */
export function releasedError(kind: ReleasedKind, tooSoon = false): string {
  if (tooSoon) {
    return `${DUE_WHAT[kind]} sooner than the reminder's notice, so it would never go off. Pick a shorter notice or a custom date.`;
  }
  return `${RELEASED_WHAT[kind]}, so a release reminder would never go off. Pick a custom date instead.`;
}

/** The dialog's note beside the greyed-out Release reminder. */
export function releasedNote(kind: ReleasedKind): string {
  return `${RELEASED_WHAT[kind]}, so only a custom date can remind you.`;
}

/**
 * A release reminder when a date is known. Music always: an artist's next album
 * has no date yet, and a reminder catches an album's date once Lidarr has one.
 */
export function defaultScheduleMode(draft: Pick<ScheduledAlertDraft, 'mediaType' | 'releaseDate'>): ScheduleMode {
  return draft.releaseDate || draft.mediaType === 'music' ? 'release_relative' : 'absolute';
}

export function defaultReleaseTypes(scope: AlertScope, mediaType: string): ReleaseKind[] {
  if (mediaType === 'movie') return ['digital'];
  if (mediaType === 'anime' || scope === 'anime') return ['airing'];
  if (mediaType === 'music') return ['album'];
  return ['episode'];
}

export function offsetLabel(minutes: number): string {
  if (minutes === 0) return 'At release time';
  if (minutes < 60) return `${minutes}m before`;
  if (minutes % 60 === 0) return `${minutes / 60}h before`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m before`;
}
