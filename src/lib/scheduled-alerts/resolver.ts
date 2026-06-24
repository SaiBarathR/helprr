import type { ScheduledAlert } from '@prisma/client';
import type { RadarrClient } from '@/lib/radarr-client';
import type { RadarrCalendarEntry } from '@/types';
import type { SonarrClient } from '@/lib/sonarr-client';
import type { SonarrCalendarEntry } from '@/types';
import { getSonarrClients, getRadarrClients } from '@/lib/service-helpers';
import { getAnimeNextAiringEpisode } from '@/lib/anilist-client';
import { DEFAULT_HORIZON_DAYS } from '@/lib/scheduled-alerts/constants';
import { applyOffset, defaultReminderLocal } from '@/lib/scheduled-alerts/helpers';
import type {
  OccurrenceCandidate,
  PreviewResult,
  ReleaseKind,
  ResolveResult,
  ScheduledAlertDraft,
  ScheduledAlertMetadata,
} from '@/lib/scheduled-alerts/types';
import { defaultReleaseTypes, defaultScopeForDraft } from '@/lib/scheduled-alerts/constants';
import { getAppTimeZone, startOfLocalDay } from '@/lib/timezone';
import type { MovieReleaseType } from '@/types';

type SourceOutcome = 'not_needed' | 'success' | 'failure';

const MAX_OFFSET_MINUTES = 10_080;

export interface ResolverContext {
  notifyStart: Date;
  notifyEnd: Date;
  calendarStartIso: string;
  calendarEndIso: string;
  radarrCalendars: Map<string, Promise<RadarrCalendarEntry[]>>;
  sonarrCalendars: Map<string, Promise<SonarrCalendarEntry[]>>;
}

export function createResolverContext(opts: { maxOffsetMinutes?: number } = {}): ResolverContext {
  const notifyStart = new Date();
  const notifyEnd = horizonEnd(DEFAULT_HORIZON_DAYS, notifyStart);
  const lookupWindow = releaseLookupWindow(
    notifyStart,
    notifyEnd,
    Math.max(0, Math.min(MAX_OFFSET_MINUTES, Math.round(opts.maxOffsetMinutes ?? MAX_OFFSET_MINUTES))),
  );

  return {
    notifyStart,
    notifyEnd,
    calendarStartIso: lookupWindow.start.toISOString(),
    calendarEndIso: lookupWindow.end.toISOString(),
    radarrCalendars: new Map(),
    sonarrCalendars: new Map(),
  };
}

function horizonEnd(days = DEFAULT_HORIZON_DAYS, from = new Date()): Date {
  const end = new Date(from);
  end.setDate(end.getDate() + days);
  return end;
}

function releaseLookupWindow(notifyStart: Date, notifyEnd: Date, offsetMinutes: number) {
  const offsetMs = offsetMinutes * 60_000;
  return {
    start: new Date(notifyStart.getTime() + Math.min(0, offsetMs)),
    end: new Date(notifyEnd.getTime() + Math.max(0, offsetMs)),
  };
}

function dateOnlyAtLocalNine(isoDate: string, timeZone: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    const [y, m, day] = isoDate.split('-').map(Number);
    const local = startOfLocalDay(new Date(), timeZone);
    local.setFullYear(y, m - 1, day);
    local.setHours(9, 0, 0, 0);
    return local;
  }
  return new Date(isoDate);
}

function candidate(
  targetKey: string,
  releaseKind: ReleaseKind,
  releaseAt: Date | null,
  notifyAt: Date,
  title: string,
  body: string,
  metadata?: Record<string, unknown>,
): OccurrenceCandidate {
  return { targetKey, releaseKind, releaseAt, notifyAt, title, body, metadata };
}

function needsRadarr(draft: ScheduledAlertDraft): boolean {
  return draft.source === 'RADARR' || (draft.mediaType === 'movie' && draft.source === 'SONARR');
}

function needsSonarr(draft: ScheduledAlertDraft): boolean {
  return draft.mediaType === 'series' || draft.source === 'SONARR';
}

function needsAnilist(draft: ScheduledAlertDraft, releaseTypes: ReleaseKind[]): boolean {
  return (draft.mediaType === 'anime' || draft.source === 'ANILIST') && releaseTypes.includes('airing');
}

function computeResolved(
  outcomes: { radarr: SourceOutcome; sonarr: SourceOutcome; anilist: SourceOutcome },
  draft: ScheduledAlertDraft,
  releaseTypes: ReleaseKind[],
  candidates: OccurrenceCandidate[],
): boolean {
  const remoteFailed =
    (needsRadarr(draft) && outcomes.radarr === 'failure') ||
    (needsSonarr(draft) && outcomes.sonarr === 'failure') ||
    (needsAnilist(draft, releaseTypes) && outcomes.anilist === 'failure');
  if (!remoteFailed) return true;
  return candidates.length > 0;
}

async function getRadarrCalendarCached(
  ctx: ResolverContext | undefined,
  connectionId: string,
  client: RadarrClient,
  startIso: string,
  endIso: string,
) {
  const key = `${connectionId}:${startIso}:${endIso}`;
  if (ctx) {
    let cached = ctx.radarrCalendars.get(key);
    if (!cached) {
      cached = client.getCalendar(startIso, endIso);
      ctx.radarrCalendars.set(key, cached);
    }
    return cached;
  }
  return client.getCalendar(startIso, endIso);
}

async function getSonarrCalendarCached(
  ctx: ResolverContext | undefined,
  connectionId: string,
  client: SonarrClient,
  startIso: string,
  endIso: string,
) {
  const key = `${connectionId}:${startIso}:${endIso}`;
  if (ctx) {
    let cached = ctx.sonarrCalendars.get(key);
    if (!cached) {
      cached = client.getCalendar(startIso, endIso);
      ctx.sonarrCalendars.set(key, cached);
    }
    return cached;
  }
  return client.getCalendar(startIso, endIso);
}

export async function previewScheduledAlert(
  draft: ScheduledAlertDraft,
  opts: {
    scheduleMode?: 'absolute' | 'release_relative';
    scope?: string;
    releaseTypes?: ReleaseKind[];
    offsetMinutes?: number;
    timeZone?: string;
    seasonNumber?: number | null;
    episodeId?: number | null;
  } = {},
): Promise<PreviewResult> {
  const timeZone = opts.timeZone ?? getAppTimeZone();
  const scope = (opts.scope && ['movie', 'series', 'season', 'episode', 'anime'].includes(opts.scope)
    ? opts.scope
    : defaultScopeForDraft({
        mediaType: draft.mediaType,
        seasonNumber: opts.seasonNumber ?? draft.seasonNumber,
        episodeId: opts.episodeId ?? draft.episodeId,
      })) as PreviewResult['defaults']['scope'];
  const releaseTypes = opts.releaseTypes?.length
    ? opts.releaseTypes
    : defaultReleaseTypes(scope, draft.mediaType);
  const offsetMinutes = opts.offsetMinutes ?? 60;
  const scheduleMode = opts.scheduleMode ?? (draft.releaseDate ? 'release_relative' : 'absolute');
  const absoluteDefault = defaultReminderLocal(draft.releaseDate, timeZone);

  const candidates =
    scheduleMode === 'absolute'
      ? [
          candidate(
            `custom:${draft.source}:${draft.externalId}`,
            'custom',
            new Date(absoluteDefault),
            new Date(absoluteDefault),
            draft.title,
            draft.subtitle ?? draft.title,
          ),
        ]
      : (
          await resolveReleaseCandidates(
            {
              ...draft,
              seasonNumber: opts.seasonNumber ?? draft.seasonNumber,
              episodeId: opts.episodeId ?? draft.episodeId,
            },
            {
              scope,
              releaseTypes,
              offsetMinutes,
              timeZone,
            },
          )
        ).candidates;

  return {
    defaults: {
      scheduleMode,
      scope,
      releaseTypes,
      offsetMinutes,
      absoluteNotifyAt: scheduleMode === 'absolute' ? absoluteDefault : null,
    },
    candidates,
  };
}

async function resolveReleaseCandidates(
  draft: ScheduledAlertDraft,
  opts: {
    scope: string;
    releaseTypes: ReleaseKind[];
    offsetMinutes: number;
    timeZone: string;
  },
  ctx?: ResolverContext,
): Promise<ResolveResult> {
  const notifyStart = ctx?.notifyStart ?? new Date();
  const notifyEnd = ctx?.notifyEnd ?? horizonEnd(DEFAULT_HORIZON_DAYS, notifyStart);
  const lookupWindow = releaseLookupWindow(notifyStart, notifyEnd, opts.offsetMinutes);
  const startIso = ctx?.calendarStartIso ?? lookupWindow.start.toISOString();
  const endIso = ctx?.calendarEndIso ?? lookupWindow.end.toISOString();
  const out: OccurrenceCandidate[] = [];

  const outcomes: { radarr: SourceOutcome; sonarr: SourceOutcome; anilist: SourceOutcome } = {
    radarr: needsRadarr(draft) ? 'failure' : 'not_needed',
    sonarr: needsSonarr(draft) ? 'failure' : 'not_needed',
    anilist: needsAnilist(draft, opts.releaseTypes) ? 'failure' : 'not_needed',
  };

  function withinNotifyHorizon(notifyAt: Date): boolean {
    return notifyAt >= notifyStart && notifyAt <= notifyEnd;
  }

  if (needsRadarr(draft)) {
    const clients = await getRadarrClients().catch(() => []);
    const applicable = clients.filter(
      ({ connection }) => !draft.instanceId || connection.id === draft.instanceId,
    );
    if (applicable.length === 0) {
      outcomes.radarr = 'failure';
    } else {
      let succeeded = false;
      for (const { connection, client } of applicable) {
        try {
          const movieId = Number.parseInt(draft.externalId, 10);
          let movie = null;
          if (Number.isFinite(movieId)) {
            movie = await client.getMovieById(movieId).catch(() => null);
          }
          if (!movie) {
            const cal = await getRadarrCalendarCached(ctx, connection.id, client, startIso, endIso);
            movie = cal.find((m: { id: number }) => String(m.id) === draft.externalId) ?? null;
          }
          if (!movie) {
            succeeded = true;
            continue;
          }
          succeeded = true;
          const releases: Array<[ReleaseKind, string | undefined]> = [];
          if (opts.releaseTypes.includes('cinema')) releases.push(['cinema', movie.inCinemas]);
          if (opts.releaseTypes.includes('digital')) releases.push(['digital', movie.digitalRelease]);
          if (opts.releaseTypes.includes('physical')) releases.push(['physical', movie.physicalRelease]);
          if (releases.length === 0 && movie.digitalRelease) releases.push(['digital', movie.digitalRelease]);
          for (const [kind, dateStr] of releases) {
            if (!dateStr) continue;
            const releaseAt = dateOnlyAtLocalNine(dateStr, opts.timeZone);
            const notifyAt = applyOffset(releaseAt, opts.offsetMinutes);
            if (!withinNotifyHorizon(notifyAt)) continue;
            out.push(
              candidate(
                `radarr:${connection.id}:${movie.id}:${kind}`,
                kind,
                releaseAt,
                notifyAt,
                movie.title,
                `${movie.year ?? ''} · ${kind} release`.trim(),
                { movieId: movie.id, instanceId: connection.id, releaseType: kind as MovieReleaseType },
              ),
            );
          }
        } catch {
          // try next instance
        }
      }
      if (succeeded) outcomes.radarr = 'success';
    }
  }

  if (needsSonarr(draft)) {
    const clients = await getSonarrClients().catch(() => []);
    const applicable = clients.filter(
      ({ connection }) => !draft.instanceId || connection.id === draft.instanceId,
    );
    if (applicable.length === 0) {
      outcomes.sonarr = 'failure';
    } else {
      let succeeded = false;
      for (const { connection, client } of applicable) {
        try {
          const cal = await getSonarrCalendarCached(ctx, connection.id, client, startIso, endIso);
          succeeded = true;
          for (const ep of cal) {
            if (String(ep.seriesId) !== draft.externalId) continue;
            if (opts.scope === 'season' && draft.seasonNumber != null && ep.seasonNumber !== draft.seasonNumber) {
              continue;
            }
            if (opts.scope === 'episode' && draft.episodeId != null && ep.id !== draft.episodeId) {
              continue;
            }
            if (!opts.releaseTypes.includes('episode') && opts.scope !== 'episode') continue;
            const releaseAt = new Date(ep.airDateUtc);
            if (!Number.isFinite(releaseAt.getTime())) continue;
            const notifyAt = applyOffset(releaseAt, opts.offsetMinutes);
            if (!withinNotifyHorizon(notifyAt)) continue;
            const subtitle = `S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')} - ${ep.title}`;
            out.push(
              candidate(
                `sonarr:${connection.id}:${ep.id}`,
                'episode',
                releaseAt,
                notifyAt,
                ep.series.title,
                subtitle,
                {
                  seriesId: ep.seriesId,
                  seasonNumber: ep.seasonNumber,
                  episodeId: ep.id,
                  instanceId: connection.id,
                },
              ),
            );
          }
        } catch {
          // try next instance
        }
      }
      if (succeeded) outcomes.sonarr = 'success';
    }
  }

  if (draft.mediaType === 'anime' || draft.source === 'ANILIST') {
    const animeId = Number.parseInt(draft.externalId, 10);
    if (Number.isFinite(animeId) && opts.releaseTypes.includes('airing')) {
      try {
        const next = await getAnimeNextAiringEpisode(animeId);
        outcomes.anilist = 'success';
        if (next) {
          const releaseAt = new Date(next.airingAt * 1000);
          const notifyAt = applyOffset(releaseAt, opts.offsetMinutes);
          if (withinNotifyHorizon(notifyAt)) {
            out.push(
              candidate(
                `anilist:${animeId}:ep${next.episode}`,
                'airing',
                releaseAt,
                notifyAt,
                draft.title,
                `Episode ${next.episode}`,
                { animeId, episode: next.episode },
              ),
            );
          }
        }
      } catch {
        outcomes.anilist = 'failure';
      }
    }
    if (draft.releaseDate && out.length === 0) {
      const releaseAt = dateOnlyAtLocalNine(draft.releaseDate, opts.timeZone);
      const notifyAt = applyOffset(releaseAt, opts.offsetMinutes);
      if (withinNotifyHorizon(notifyAt)) {
        out.push(
          candidate(
            `anilist:${draft.externalId}:release`,
            'airing',
            releaseAt,
            notifyAt,
            draft.title,
            draft.subtitle ?? 'Release date',
          ),
        );
      }
    }
  }

  if (out.length === 0 && draft.releaseDate) {
    const releaseAt = dateOnlyAtLocalNine(draft.releaseDate, opts.timeZone);
    const notifyAt = applyOffset(releaseAt, opts.offsetMinutes);
    if (withinNotifyHorizon(notifyAt)) {
      out.push(
        candidate(
          `tmdb:${draft.externalId}:release`,
          opts.releaseTypes[0] ?? 'custom',
          releaseAt,
          notifyAt,
          draft.title,
          draft.subtitle ?? 'Release date',
        ),
      );
    }
  }

  out.sort((a, b) => a.notifyAt.getTime() - b.notifyAt.getTime());
  return {
    candidates: out,
    resolved: computeResolved(outcomes, draft, opts.releaseTypes, out),
  };
}

export async function resolveAlertOccurrencesResult(
  alert: ScheduledAlert,
  ctx?: ResolverContext,
): Promise<ResolveResult> {
  if (alert.scheduleMode === 'absolute') {
    return { candidates: [], resolved: true };
  }

  const metadata = (alert.metadata ?? {}) as ScheduledAlertMetadata;
  const releaseTypes = Array.isArray(alert.releaseTypes)
    ? (alert.releaseTypes as ReleaseKind[])
    : [];

  const draft: ScheduledAlertDraft = {
    source: alert.source as ScheduledAlertDraft['source'],
    externalId: alert.externalId,
    mediaType: alert.mediaType as ScheduledAlertDraft['mediaType'],
    title: alert.title,
    subtitle: alert.subtitle,
    posterUrl: alert.posterUrl,
    href: alert.href,
    instanceId: alert.instanceId,
    seasonNumber: metadata.seasonNumber ?? null,
    episodeId: metadata.episodeId ?? null,
  };

  return resolveReleaseCandidates(
    draft,
    {
      scope: alert.scope,
      releaseTypes: releaseTypes.length ? releaseTypes : defaultReleaseTypes(alert.scope as never, alert.mediaType),
      offsetMinutes: alert.offsetMinutes,
      timeZone: alert.timeZone,
    },
    ctx,
  );
}

/** @deprecated Prefer resolveAlertOccurrencesResult when stale cleanup depends on resolution status. */
export async function resolveAlertOccurrences(
  alert: ScheduledAlert,
  ctx?: ResolverContext,
): Promise<OccurrenceCandidate[]> {
  const result = await resolveAlertOccurrencesResult(alert, ctx);
  return result.candidates;
}
