import {
  isValidMediaType,
  isValidSource,
  watchlistHrefFor,
  type WatchlistMediaType,
  type WatchlistSource,
} from '@/lib/watchlist-helpers';
import { getAppTimeZone, startOfLocalDay } from '@/lib/timezone';
import type {
  AlertScope,
  CreateScheduledAlertInput,
  ReleaseKind,
  ScheduleMode,
  ScheduledAlertDraft,
} from '@/lib/scheduled-alerts/types';
import { ALERT_SCOPES, DEFAULT_OFFSET_MINUTES, RELEASE_KINDS, SCHEDULE_MODES, defaultReleaseTypes, defaultScopeForDraft } from '@/lib/scheduled-alerts/constants';

const MAX_TITLE_LEN = 200;
const MAX_POSTER_URL_LEN = 500;

export function isScheduleMode(v: string): v is ScheduleMode {
  return (SCHEDULE_MODES as readonly string[]).includes(v);
}

export function isAlertScope(v: string): v is AlertScope {
  return (ALERT_SCOPES as readonly string[]).includes(v);
}

export function isReleaseKind(v: string): v is ReleaseKind {
  return (RELEASE_KINDS as readonly string[]).includes(v);
}

export function parseReleaseTypes(raw: unknown): ReleaseKind[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is ReleaseKind => typeof v === 'string' && isReleaseKind(v));
}

export function validatePosterUrl(raw: string): string | null {
  if (raw.length > MAX_POSTER_URL_LEN) return null;
  if (!/^https?:\/\//i.test(raw)) return null;
  return raw;
}

export function validateInternalHref(raw: string): string | null {
  const value = raw.trim();
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  return value.slice(0, 500);
}

export function defaultReminderLocal(releaseDate: string | null | undefined, timeZone: string): string {
  if (!releaseDate) {
    const tomorrow = startOfLocalDay(new Date(), timeZone);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    return tomorrow.toISOString();
  }
  const d = new Date(releaseDate);
  if (!Number.isFinite(d.getTime())) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) {
    const [y, m, day] = releaseDate.split('-').map(Number);
    const local = startOfLocalDay(new Date(), timeZone);
    local.setFullYear(y, m - 1, day);
    local.setHours(9, 0, 0, 0);
    return local.toISOString();
  }
  return d.toISOString();
}

export function applyOffset(releaseAt: Date, offsetMinutes: number): Date {
  return new Date(releaseAt.getTime() - offsetMinutes * 60_000);
}

export function normalizeDraft(raw: Record<string, unknown>): ScheduledAlertDraft | null {
  const source = typeof raw.source === 'string' ? raw.source.toUpperCase() : '';
  const externalId =
    typeof raw.externalId === 'string'
      ? raw.externalId
      : typeof raw.externalId === 'number'
        ? String(raw.externalId)
        : '';
  const mediaType = typeof raw.mediaType === 'string' ? raw.mediaType.toLowerCase() : '';
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, MAX_TITLE_LEN) : '';

  if (!isValidSource(source) || !externalId || !isValidMediaType(mediaType) || !title) return null;

  const posterUrl =
    typeof raw.posterUrl === 'string' ? validatePosterUrl(raw.posterUrl) ?? undefined : undefined;

  return {
    source: source as WatchlistSource,
    externalId,
    mediaType: mediaType as WatchlistMediaType,
    title,
    subtitle: typeof raw.subtitle === 'string' ? raw.subtitle : null,
    year: typeof raw.year === 'number' && Number.isFinite(raw.year) ? raw.year : null,
    posterUrl: posterUrl ?? null,
    href:
      typeof raw.href === 'string'
        ? validateInternalHref(raw.href)
        : raw.href === null
          ? null
          : watchlistHrefFor(source, externalId, mediaType),
    instanceId: typeof raw.instanceId === 'string' ? raw.instanceId : null,
    releaseDate: typeof raw.releaseDate === 'string' ? raw.releaseDate : null,
    seasonNumber:
      typeof raw.seasonNumber === 'number' && Number.isFinite(raw.seasonNumber)
        ? raw.seasonNumber
        : null,
    episodeId:
      typeof raw.episodeId === 'number' && Number.isFinite(raw.episodeId) ? raw.episodeId : null,
  };
}

export function parseCreateInput(body: Record<string, unknown>, fallbackTz: string): CreateScheduledAlertInput | { error: string } {
  const draft = normalizeDraft((body.draft as Record<string, unknown>) ?? body);
  if (!draft) return { error: 'Invalid media draft' };

  const scheduleMode =
    typeof body.scheduleMode === 'string'
      ? body.scheduleMode
      : draft.releaseDate
        ? 'release_relative'
        : 'absolute';
  if (!isScheduleMode(scheduleMode)) return { error: 'Invalid scheduleMode' };

  const scope =
    typeof body.scope === 'string' && isAlertScope(body.scope)
      ? body.scope
      : defaultScopeForDraft(draft);

  const parsedReleaseTypes = parseReleaseTypes(body.releaseTypes);
  const releaseTypes =
    parsedReleaseTypes.length > 0 ? parsedReleaseTypes : defaultReleaseTypes(scope, draft.mediaType);
  const offsetMinutes =
    typeof body.offsetMinutes === 'number' && Number.isFinite(body.offsetMinutes)
      ? Math.max(0, Math.min(10_080, Math.round(body.offsetMinutes)))
      : DEFAULT_OFFSET_MINUTES;

  const timeZone =
    typeof body.timeZone === 'string' && body.timeZone.trim() ? body.timeZone.trim() : fallbackTz;

  let absoluteNotifyAt: string | null = null;
  if (scheduleMode === 'absolute') {
    const raw = body.absoluteNotifyAt;
    if (typeof raw !== 'string' || !raw.trim()) return { error: 'absoluteNotifyAt is required' };
    const d = new Date(raw);
    if (!Number.isFinite(d.getTime())) return { error: 'Invalid absoluteNotifyAt' };
    if (d.getTime() < Date.now() - 60_000) return { error: 'Reminder must be in the future' };
    absoluteNotifyAt = d.toISOString();
  }

  return {
    draft,
    scheduleMode,
    scope,
    releaseTypes,
    offsetMinutes,
    timeZone,
    absoluteNotifyAt,
  };
}

export function ruleSummary(args: {
  scheduleMode: ScheduleMode;
  scope: AlertScope;
  releaseTypes: ReleaseKind[];
  offsetMinutes: number;
}): string {
  if (args.scheduleMode === 'absolute') return 'Custom date/time';
  const kinds = args.releaseTypes.length ? args.releaseTypes.join(', ') : args.scope;
  const offset =
    args.offsetMinutes === 0 ? 'at release' : `${args.offsetMinutes}m before`;
  return `${kinds} · ${offset}`;
}

export function resolveHref(draft: ScheduledAlertDraft): string | null {
  if (draft.href) return draft.href;
  if (draft.href === null) return null;
  return watchlistHrefFor(draft.source, draft.externalId, draft.mediaType);
}

export function getDefaultTimeZone(userTz?: string | null): string {
  return userTz && userTz.trim() ? userTz : getAppTimeZone();
}
