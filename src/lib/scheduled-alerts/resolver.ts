import type { ScheduledAlert } from '@prisma/client';
import type { RadarrClient } from '@/lib/radarr-client';
import type { RadarrCalendarEntry } from '@/types';
import type { SonarrClient } from '@/lib/sonarr-client';
import type { SonarrCalendarEntry } from '@/types';
import axios from 'axios';
import { getSonarrClients, getRadarrClients, getLidarrClients, getTMDBClient } from '@/lib/service-helpers';
import { loadCachedArrLibrary, type ArrLibrary } from '@/lib/cache/arr-library';
import { getOrCreateAppSettings } from '@/lib/app-settings';
import { ConfigurationError } from '@/lib/config-error';
import type { TmdbReleaseDatesResponse } from '@/lib/tmdb-client';
import type { LidarrAlbum } from '@/types/lidarr';
import { getAnimeNextAiringEpisode } from '@/lib/anilist-client';
import { DEFAULT_HORIZON_DAYS, RELEASE_KIND_LABELS } from '@/lib/scheduled-alerts/constants';
import { applyOffset, defaultReminderLocal, isAlertScope, scopeFitsMediaType } from '@/lib/scheduled-alerts/helpers';
import { noteJobFailure } from '@/lib/polling-job-report';
import type {
  OccurrenceCandidate,
  PreviewResult,
  ReleaseKind,
  ReleasedKind,
  ResolveResult,
  ScheduledAlertDraft,
  ScheduledAlertMetadata,
  UpcomingAlbum,
} from '@/lib/scheduled-alerts/types';
import { defaultReleaseTypes, defaultScheduleMode, defaultScopeForDraft } from '@/lib/scheduled-alerts/constants';
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
  /** The Radarr/Sonarr library, read once per refresh cycle for every TMDB/TVDB alert. */
  library?: Promise<ArrLibrary>;
}

function libraryFor(ctx: ResolverContext | undefined): Promise<ArrLibrary> {
  if (!ctx) return loadCachedArrLibrary();
  ctx.library ??= loadCachedArrLibrary();
  return ctx.library;
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

function needsLidarr(draft: ScheduledAlertDraft): boolean {
  return draft.source === 'LIDARR';
}

function needsAnilist(draft: ScheduledAlertDraft, releaseTypes: ReleaseKind[]): boolean {
  return (draft.mediaType === 'anime' || draft.source === 'ANILIST') && releaseTypes.includes('airing');
}

/**
 * A film or series saved by its TMDB/TVDB id (from Discover or the
 * watchlist): it is found in the library by that id kind, else read from TMDB.
 */
function externalIdSource(draft: ScheduledAlertDraft): 'TMDB' | 'TVDB' | null {
  if (!/^[1-9]\d*$/.test(draft.externalId)) return null;
  if (draft.source === 'TMDB' && (draft.mediaType === 'movie' || draft.mediaType === 'series')) return 'TMDB';
  if (draft.source === 'TVDB' && draft.mediaType === 'series') return 'TVDB';
  return null;
}

/** Each source starts as 'failure' when it is needed and 'not_needed' otherwise. */
type SourceOutcomes = Record<'radarr' | 'sonarr' | 'lidarr' | 'anilist' | 'library' | 'tmdb', SourceOutcome>;

function computeResolved(outcomes: SourceOutcomes, candidates: OccurrenceCandidate[]): boolean {
  return !Object.values(outcomes).includes('failure') || candidates.length > 0;
}

interface FilmDates {
  inCinemas?: string;
  digitalRelease?: string;
  physicalRelease?: string;
}

/**
 * A film's releases to remind of, and whether every one is already out: it
 * has passed, or has no date while the film is already out at home (so it is
 * not coming). A date still unknown otherwise can be reminded of once known.
 * Radarr and TMDB date a release by its day, so the reminder is for 9:00 that
 * day in the alert's time zone, as for albums.
 */
function filmReleasesToRemind(film: FilmDates, releaseTypes: ReleaseKind[], timeZone: string, now: Date, offsetMinutes: number) {
  const at = (date: string | undefined) => {
    const releaseAt = date ? dateOnlyAtLocalNine(date.slice(0, 10), timeZone) : null;
    return releaseAt && Number.isFinite(releaseAt.getTime()) ? releaseAt : null;
  };
  const releases: Array<[ReleaseKind, Date | null]> = [];
  if (releaseTypes.includes('cinema')) releases.push(['cinema', at(film.inCinemas)]);
  if (releaseTypes.includes('digital')) releases.push(['digital', at(film.digitalRelease)]);
  if (releaseTypes.includes('physical')) releases.push(['physical', at(film.physicalRelease)]);
  if (releases.length === 0 && film.digitalRelease) releases.push(['digital', at(film.digitalRelease)]);
  const passed = (releaseAt: Date | null, offset = 0) => releaseAt !== null && applyOffset(releaseAt, offset) <= now;
  const outAtHome = passed(at(film.digitalRelease)) || passed(at(film.physicalRelease));
  const gone = (offset: number) =>
    releases.length > 0 && releases.every(([, releaseAt]) => passed(releaseAt, offset) || (releaseAt === null && outAtHome));
  // tooLate: every reminder's time (release − offset) has passed, so none can go off.
  return { releases, tooLate: gone(offsetMinutes), out: gone(0) };
}

const TMDB_RELEASE_TYPES = { inCinemas: 3, digitalRelease: 4, physicalRelease: 5 } as const;

/** A film's cinema, digital and physical dates on TMDB: in Helprr's region, else the US, else the earliest anywhere. */
function tmdbFilmDates(res: TmdbReleaseDatesResponse, region: string): FilmDates {
  const earliest = (entries: TmdbReleaseDatesResponse['results'], type: number) =>
    entries.flatMap((r) => r.release_dates).filter((d) => d.type === type && d.release_date).map((d) => d.release_date).sort()[0];
  const inCountry = (code: string) => (res.results ?? []).filter((r) => r.iso_3166_1 === code);
  const dates: FilmDates = {};
  for (const [field, type] of Object.entries(TMDB_RELEASE_TYPES) as Array<[keyof FilmDates, number]>) {
    dates[field] = earliest(inCountry(region), type) ?? earliest(inCountry('US'), type) ?? earliest(res.results ?? [], type);
  }
  return dates;
}

function episodeCode(seasonNumber: number, episodeNumber: number): string {
  return `S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`;
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
  const scope = (opts.scope && isAlertScope(opts.scope) && scopeFitsMediaType(opts.scope, draft.mediaType)
    ? opts.scope
    : defaultScopeForDraft({
        mediaType: draft.mediaType,
        seasonNumber: opts.seasonNumber ?? draft.seasonNumber,
        episodeId: opts.episodeId ?? draft.episodeId,
        albumId: draft.albumId,
      })) as PreviewResult['defaults']['scope'];
  let releaseTypes = opts.releaseTypes?.length
    ? opts.releaseTypes
    : defaultReleaseTypes(scope, draft.mediaType);
  const offsetMinutes = opts.offsetMinutes ?? 60;
  const requestedMode = opts.scheduleMode ?? defaultScheduleMode(draft);
  const resolveFor = (kinds: ReleaseKind[]) => resolveReleaseCandidates(
    {
      ...draft,
      seasonNumber: opts.seasonNumber ?? draft.seasonNumber,
      episodeId: opts.episodeId ?? draft.episodeId,
    },
    {
      scope,
      releaseTypes: kinds,
      offsetMinutes,
      timeZone,
      checkAired: true,
    },
  );

  // Only something actually out: one due sooner than its notice still takes a
  // release reminder with a shorter notice, which the save then accepts.
  const outNow = (result: ResolveResult | null) => (result?.released && !result.tooSoon ? result.released : undefined);
  let resolved = requestedMode === 'release_relative' ? await resolveFor(releaseTypes) : null;
  // A film already out digitally may still have its disc ahead: offer that.
  if (outNow(resolved) === 'movie' && !opts.releaseTypes?.length) {
    const disc = await resolveFor(['physical']);
    if (disc.resolved && !disc.released) {
      resolved = disc;
      releaseTypes = ['physical'];
    }
  }
  // The same verdict the save gives: an album, film or episode already out
  // opens on a custom date from tomorrow, as its release reminder could never
  // go off.
  const released = outNow(resolved);
  const scheduleMode = released && !opts.scheduleMode ? 'absolute' : requestedMode;
  const absoluteDefault = defaultReminderLocal(released ? null : draft.releaseDate, timeZone);

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
      : resolved?.candidates ?? [];

  return {
    defaults: {
      scheduleMode,
      scope,
      releaseTypes,
      offsetMinutes,
      absoluteNotifyAt: scheduleMode === 'absolute' ? absoluteDefault : null,
    },
    candidates,
    ...(released ? { released } : {}),
  };
}

async function resolveReleaseCandidates(
  draft: ScheduledAlertDraft,
  opts: {
    scope: string;
    releaseTypes: ReleaseKind[];
    offsetMinutes: number;
    timeZone: string;
    /** Ask Sonarr whether an episode off the calendar has aired: only a save or an edit needs that verdict. */
    checkAired?: boolean;
  },
  ctx?: ResolverContext,
): Promise<ResolveResult> {
  const notifyStart = ctx?.notifyStart ?? new Date();
  const notifyEnd = ctx?.notifyEnd ?? horizonEnd(DEFAULT_HORIZON_DAYS, notifyStart);
  const lookupWindow = releaseLookupWindow(notifyStart, notifyEnd, opts.offsetMinutes);
  const startIso = ctx?.calendarStartIso ?? lookupWindow.start.toISOString();
  const endIso = ctx?.calendarEndIso ?? lookupWindow.end.toISOString();
  const out: OccurrenceCandidate[] = [];
  const upcomingAlbums: UpcomingAlbum[] = [];
  let released: ReleasedKind | null = null;
  // Not out yet, but due sooner than the reminder's notice.
  let tooSoon = false;
  const judge = (kind: ReleasedKind, releaseAt: Date) => {
    if (applyOffset(releaseAt, opts.offsetMinutes) > notifyStart) return;
    released = kind;
    if (releaseAt > notifyStart) tooSoon = true;
  };

  // Saved by its TMDB/TVDB id: its library copy, matched by that id kind
  // (never a TMDB id read as a Sonarr id). One copy per title, the default
  // instance's else the first that has it, so a film in two Radarrs is
  // reminded of once.
  const idSource = externalIdSource(draft);
  let radarrTarget: { instanceId: string; id: string } | null = null;
  let sonarrTarget: { instanceId: string; id: string } | null = null;
  let libraryFailed = false;
  if (idSource) {
    try {
      const isMovie = draft.mediaType === 'movie';
      const [library, instances] = await Promise.all([libraryFor(ctx), isMovie ? getRadarrClients() : getSonarrClients()]);
      // An instance that did not answer may hold the title: reading TMDB
      // instead would trade a correct reminder for another and back.
      if (instances.length > 0 && !(isMovie ? library.moviesComplete : library.seriesComplete)) {
        throw new Error(`A ${isMovie ? 'Radarr' : 'Sonarr'} instance did not answer`);
      }
      const id = Number(draft.externalId);
      let matches: Array<{ id: number; instanceId: string }>;
      if (isMovie) {
        matches = library.movies.filter((m) => m.tmdbId === id);
      } else {
        matches = library.series.filter((s) => (idSource === 'TVDB' ? s.tvdbId : s.tmdbId) === id);
        // Sonarr v3 keeps no TMDB id: match by the TVDB id TMDB gives.
        if (idSource === 'TMDB' && matches.length === 0) {
          const tvdbId = await getTMDBClient()
            .then((tmdb) => tmdb.tvExternalIds(id))
            .then((ids) => ids.tvdb_id ?? null)
            .catch(() => null);
          if (tvdbId) matches = library.series.filter((s) => s.tvdbId === tvdbId);
        }
      }
      // Instances come default first.
      const match = instances
        .map(({ connection }) => connection.id)
        .filter((instanceId) => !draft.instanceId || instanceId === draft.instanceId)
        .map((instanceId) => matches.find((m) => m.instanceId === instanceId))
        .find((m) => m !== undefined);
      const target = match ? { instanceId: match.instanceId, id: String(match.id) } : null;
      if (isMovie) radarrTarget = target;
      else sonarrTarget = target;
    } catch (error) {
      noteJobFailure(error);
      libraryFailed = true;
    }
  }
  const useRadarr = needsRadarr(draft) || radarrTarget !== null;
  const useSonarr = sonarrTarget !== null || (needsSonarr(draft) && !idSource);
  // Not in the library: TMDB's own dates.
  const useTmdb = idSource !== null && !libraryFailed && (draft.mediaType === 'movie' ? radarrTarget : sonarrTarget) === null;

  const outcomes: SourceOutcomes = {
    radarr: useRadarr ? 'failure' : 'not_needed',
    sonarr: useSonarr ? 'failure' : 'not_needed',
    lidarr: needsLidarr(draft) ? 'failure' : 'not_needed',
    anilist: needsAnilist(draft, opts.releaseTypes) ? 'failure' : 'not_needed',
    library: libraryFailed ? 'failure' : 'not_needed',
    tmdb: useTmdb ? 'failure' : 'not_needed',
  };

  function withinNotifyHorizon(notifyAt: Date): boolean {
    return notifyAt >= notifyStart && notifyAt <= notifyEnd;
  }

  if (useRadarr) {
    const clients = await getRadarrClients().catch((error) => {
      noteJobFailure(error);
      return [];
    });
    const applicable = clients.filter(({ connection }) =>
      radarrTarget ? connection.id === radarrTarget.instanceId : !draft.instanceId || connection.id === draft.instanceId,
    );
    if (applicable.length === 0) {
      outcomes.radarr = 'failure';
    } else {
      let succeeded = false;
      for (const { connection, client } of applicable) {
        try {
          const targetId = radarrTarget?.id ?? draft.externalId;
          const movieId = Number.parseInt(targetId, 10);
          let movie = null;
          if (Number.isFinite(movieId)) {
            // A film Radarr no longer has falls back to the calendar; other errors are failures.
            movie = await client.getMovieById(movieId).catch((error) => {
              if (!(axios.isAxiosError(error) && error.response?.status === 404)) noteJobFailure(error);
              return null;
            });
          }
          if (!movie) {
            const cal = await getRadarrCalendarCached(ctx, connection.id, client, startIso, endIso);
            movie = cal.find((m: { id: number }) => String(m.id) === targetId) ?? null;
          }
          if (!movie) {
            succeeded = true;
            continue;
          }
          succeeded = true;
          const { releases, tooLate, out: filmOut } = filmReleasesToRemind(movie, opts.releaseTypes, opts.timeZone, notifyStart, opts.offsetMinutes);
          if (tooLate) {
            released = 'movie';
            if (!filmOut) tooSoon = true;
          }
          for (const [kind, releaseAt] of releases) {
            if (!releaseAt) continue;
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
        } catch (error) {
          // Try the next instance; the polling job still failed.
          noteJobFailure(error);
        }
      }
      if (succeeded) outcomes.radarr = 'success';
    }
  }

  if (useSonarr) {
    const clients = await getSonarrClients().catch((error) => {
      noteJobFailure(error);
      return [];
    });
    const applicable = clients.filter(({ connection }) =>
      sonarrTarget ? connection.id === sonarrTarget.instanceId : !draft.instanceId || connection.id === draft.instanceId,
    );
    if (applicable.length === 0) {
      outcomes.sonarr = 'failure';
    } else {
      let succeeded = false;
      for (const { connection, client } of applicable) {
        try {
          const targetId = sonarrTarget?.id ?? draft.externalId;
          const cal = await getSonarrCalendarCached(ctx, connection.id, client, startIso, endIso);
          succeeded = true;
          for (const ep of cal) {
            if (String(ep.seriesId) !== targetId) continue;
            if (opts.scope === 'season' && draft.seasonNumber != null && ep.seasonNumber !== draft.seasonNumber) {
              continue;
            }
            if (opts.scope === 'episode' && draft.episodeId != null && ep.id !== draft.episodeId) {
              continue;
            }
            if (!opts.releaseTypes.includes('episode') && opts.scope !== 'episode') continue;
            const releaseAt = new Date(ep.airDateUtc);
            if (!Number.isFinite(releaseAt.getTime())) continue;
            if (opts.scope === 'episode' && ep.id === draft.episodeId) judge('episode', releaseAt);
            const notifyAt = applyOffset(releaseAt, opts.offsetMinutes);
            if (!withinNotifyHorizon(notifyAt)) continue;
            const subtitle = `${episodeCode(ep.seasonNumber, ep.episodeNumber)} - ${ep.title}`;
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
          // The calendar starts now, so an episode not on it has aired or is
          // further off: ask Sonarr which. One it no longer has is neither.
          if (opts.checkAired && opts.scope === 'episode' && draft.episodeId != null && !cal.some((ep) => ep.id === draft.episodeId)) {
            const episode = await client.getEpisodeById(draft.episodeId).catch((error) => {
              if (!(axios.isAxiosError(error) && error.response?.status === 404)) noteJobFailure(error);
              return null;
            });
            const airsAt = episode && String(episode.seriesId) === targetId && episode.airDateUtc ? new Date(episode.airDateUtc) : null;
            if (airsAt && Number.isFinite(airsAt.getTime())) judge('episode', airsAt);
          }
        } catch (error) {
          // Try the next instance; the polling job still failed.
          noteJobFailure(error);
        }
      }
      if (succeeded) outcomes.sonarr = 'success';
    }
  }

  if (useTmdb) {
    try {
      const tmdb = await getTMDBClient();
      const id = Number(draft.externalId);
      if (draft.mediaType === 'movie') {
        const { watchProviderRegion } = await getOrCreateAppSettings();
        const film = tmdbFilmDates(await tmdb.movieReleaseDates(id), watchProviderRegion || 'US');
        const { releases, tooLate, out: filmOut } = filmReleasesToRemind(film, opts.releaseTypes, opts.timeZone, notifyStart, opts.offsetMinutes);
        if (tooLate) {
          released = 'movie';
          if (!filmOut) tooSoon = true;
        }
        for (const [kind, releaseAt] of releases) {
          if (!releaseAt) continue;
          const notifyAt = applyOffset(releaseAt, opts.offsetMinutes);
          if (!withinNotifyHorizon(notifyAt)) continue;
          out.push(candidate(`tmdb:movie:${id}:${kind}`, kind, releaseAt, notifyAt, draft.title, RELEASE_KIND_LABELS[kind], { tmdbId: id, releaseType: kind }));
        }
      } else if (opts.releaseTypes.includes('episode')) {
        const tmdbId = idSource === 'TVDB' ? (await tmdb.findByExternalId(draft.externalId, 'tvdb_id')).tv_results[0]?.id : id;
        // TMDB knows only the next episode, by its day: remind at 9:00 that day.
        const next = tmdbId ? (await tmdb.tvDetails(tmdbId)).next_episode_to_air : null;
        const inScope = next && !(opts.scope === 'season' && draft.seasonNumber != null && next.season_number !== draft.seasonNumber);
        if (next?.air_date && inScope) {
          const releaseAt = dateOnlyAtLocalNine(next.air_date, opts.timeZone);
          const notifyAt = applyOffset(releaseAt, opts.offsetMinutes);
          if (Number.isFinite(releaseAt.getTime()) && withinNotifyHorizon(notifyAt)) {
            const code = episodeCode(next.season_number, next.episode_number);
            out.push(candidate(`tmdb:tv:${tmdbId}:${code}`, 'episode', releaseAt, notifyAt, draft.title, next.name ? `${code} - ${next.name}` : code, {
              tmdbId, seasonNumber: next.season_number, episodeNumber: next.episode_number,
            }));
          }
        }
      }
      outcomes.tmdb = 'success';
    } catch (error) {
      // Without TMDB set up the alert simply waits; anything else is a failure.
      if (!(error instanceof ConfigurationError)) noteJobFailure(error);
    }
  }

  if (needsLidarr(draft)) {
    const clients = await getLidarrClients().catch((error) => {
      noteJobFailure(error);
      return [];
    });
    const applicable = clients.filter(
      ({ connection }) => !draft.instanceId || connection.id === draft.instanceId,
    );
    const id = Number.parseInt(draft.externalId, 10);
    let succeeded = false;
    for (const { connection, client } of Number.isFinite(id) ? applicable : []) {
      try {
        // One album, or every album Lidarr knows of for the artist: a new one is
        // picked up on the next refresh after Lidarr learns of it.
        let albums: LidarrAlbum[];
        if (opts.scope === 'album') {
          // An album Lidarr no longer has gives no reminder; other errors are failures.
          const album = await client.getAlbumById(id).catch((error) => {
            if (axios.isAxiosError(error) && error.response?.status === 404) return null;
            throw error;
          });
          albums = album ? [album] : [];
        } else {
          albums = await client.getAlbums(id);
        }
        succeeded = true;
        for (const album of albums) {
          if (!album.releaseDate) continue;
          // Lidarr's release date is a calendar day (midnight UTC): remind on that local day.
          const releaseAt = dateOnlyAtLocalNine(album.releaseDate.slice(0, 10), opts.timeZone);
          if (!Number.isFinite(releaseAt.getTime())) continue;
          if (opts.scope === 'album') judge('album', releaseAt);
          const artistName = album.artist?.artistName ?? (opts.scope === 'album' ? draft.subtitle : draft.title);
          if (opts.scope === 'artist' && releaseAt > notifyStart) {
            upcomingAlbums.push({ key: `${connection.id}:${album.id}`, title: album.title, artistName: artistName || draft.title, releaseAt });
          }
          const notifyAt = applyOffset(releaseAt, opts.offsetMinutes);
          if (!withinNotifyHorizon(notifyAt)) continue;
          out.push(
            candidate(
              `lidarr:${connection.id}:${album.id}`,
              'album',
              releaseAt,
              notifyAt,
              // Same title and subtitle as the album on the calendar, so the two merge.
              artistName || album.title,
              album.title,
              { albumId: album.id, artistId: album.artistId, instanceId: connection.id },
            ),
          );
        }
      } catch (error) {
        // Try the next instance; the polling job still failed.
        noteJobFailure(error);
      }
    }
    if (succeeded) outcomes.lidarr = 'success';
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
      } catch (error) {
        noteJobFailure(error);
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

  // The draft's own date (a preview only: a saved alert keeps none). A title
  // saved by its TMDB/TVDB id was resolved above, as its save will be.
  if (out.length === 0 && draft.releaseDate && !idSource) {
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
    resolved: computeResolved(outcomes, out),
    ...(opts.scope === 'artist' && needsLidarr(draft) ? { upcomingAlbums } : {}),
    // Another instance's reminder still goes off.
    ...(released && out.length === 0 ? { released, ...(tooSoon ? { tooSoon: true as const } : {}) } : {}),
  };
}

export async function resolveAlertOccurrencesResult(
  alert: ScheduledAlert,
  ctx?: ResolverContext,
  options: { checkAired?: boolean } = {},
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
      checkAired: options.checkAired,
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
