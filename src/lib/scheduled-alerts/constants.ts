import type { AlertScope, ReleaseKind, ScheduleMode, ScheduledAlertDraft } from '@/lib/scheduled-alerts/types';

export const SCHEDULE_MODES: ScheduleMode[] = ['absolute', 'release_relative'];
export const ALERT_SCOPES: AlertScope[] = ['movie', 'series', 'season', 'episode', 'anime'];
export const RELEASE_KINDS: ReleaseKind[] = ['custom', 'cinema', 'digital', 'physical', 'episode', 'season', 'airing'];

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
};

export function defaultScopeForMediaType(mediaType: string): AlertScope {
  if (mediaType === 'movie') return 'movie';
  if (mediaType === 'anime') return 'anime';
  return 'series';
}

export function defaultScopeForDraft(draft: Pick<ScheduledAlertDraft, 'mediaType' | 'seasonNumber' | 'episodeId'>): AlertScope {
  if (draft.mediaType === 'movie') return 'movie';
  if (draft.mediaType === 'anime') return 'anime';
  if (draft.episodeId != null) return 'episode';
  if (draft.seasonNumber != null) return 'season';
  return 'series';
}

export function defaultReleaseTypes(scope: AlertScope, mediaType: string): ReleaseKind[] {
  if (mediaType === 'movie') return ['digital'];
  if (mediaType === 'anime' || scope === 'anime') return ['airing'];
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
