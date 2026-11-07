// Gathers the facts library cleanup decides on, failing closed: if a configured
// Sonarr/Radarr instance, Jellyfin or Seerr cannot be read completely, the whole
// gather throws LibraryCleanupUnavailableError and nothing is listed or deleted.

import type { ServiceConnection } from '@prisma/client';
import { prisma } from '@/lib/db';
import { ConfigurationError } from '@/lib/config-error';
import { JellyfinClient } from '@/lib/jellyfin-client';
import {
  getJellyfinClientContext,
  getRadarrClients,
  getSeerrClient,
  getSonarrClients,
} from '@/lib/service-helpers';
import { getConnectionHeaders } from '@/lib/service-connection-secrets';
import { fetchFullQueue } from '@/lib/cleanup/queue-pagination';
import { loadAnilistIdsBySeries } from '@/lib/anilist-series-mapping';
import { watchlistItemMatches } from '@/lib/polling/watchlist-available';
import { getCachedSeerrMediaDetail } from '@/lib/seerr-helpers';
import { SEERR_MEDIA_STATUS, SEERR_REQUEST_STATUS, type SeerrRequest } from '@/types/seerr';
import type { JellyfinItem, JellyfinItemsResponse } from '@/types/jellyfin';
import type { MediaImage, QueueResponse, RadarrMovie, SonarrSeries } from '@/types';
import type { LibraryMediaType } from './config';
import { titleKey, type TitleFacts } from './evaluate';

export class LibraryCleanupUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LibraryCleanupUnavailableError';
  }
}

export interface GatheredFacts {
  titles: TitleFacts[];
  /** Per instance read: the keep tag's id there (null when the tag does not exist yet). */
  keepTagIds: Map<string, number | null>;
  /** False when no Seerr connection exists (Delete now refuses then). */
  seerrConnected: boolean;
  /** Non-blocking notes, e.g. Seerr is not connected so no requests were checked. */
  warnings: string[];
}

function fail(what: string, error?: unknown): never {
  const reason = error instanceof Error ? `: ${error.message}` : '';
  throw new LibraryCleanupUnavailableError(`${what} could not be read${reason}. Nothing was changed.`);
}

function posterOf(images: MediaImage[] | undefined): string | null {
  // Only the remote URL: the local one is a path on the arr that the browser cannot load.
  return images?.find((image) => image.coverType === 'poster')?.remoteUrl || null;
}

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

// ── Sonarr / Radarr ─────────────────────────────────────────────────────────

interface ArrTitle {
  connection: ServiceConnection;
  /** Every name the arr knows the title by, for matching watchlist saves by title. */
  names: string[];
  facts: Omit<TitleFacts, 'inJellyfin' | 'lastWatchedAt' | 'watchedWithoutDate' | 'watchlistUserIds' | 'openRequest' | 'latestRequestAt' | 'requestedBy' | 'requesterUserIds'>;
}

interface ArrClientLike {
  getTags(): Promise<Array<{ id: number; label: string }>>;
  getQueue(page: number, pageSize: number): Promise<QueueResponse>;
}

async function readArrInstance<T>(
  name: string,
  connection: ServiceConnection,
  client: ArrClientLike,
  list: () => Promise<T[]>,
  queueId: (record: QueueResponse['records'][number]) => number | undefined,
  keepTag: string,
): Promise<{ items: T[]; keepTagId: number | null; downloading: Set<number> }> {
  const label = `${name} (${connection.label})`;
  try {
    const [items, tags, queue] = await Promise.all([
      list(),
      client.getTags(),
      fetchFullQueue((page, pageSize) => client.getQueue(page, pageSize)),
    ]);
    if (!Array.isArray(items) || !Array.isArray(tags)) fail(label);
    if (queue === null) fail(`${label} queue`);
    const keepTagId = tags.find((tag) => tag.label.toLowerCase() === keepTag)?.id ?? null;
    const downloading = new Set<number>();
    for (const record of queue) {
      const id = queueId(record);
      if (id) downloading.add(id);
    }
    return { items, keepTagId, downloading };
  } catch (error) {
    if (error instanceof LibraryCleanupUnavailableError) throw error;
    fail(label, error);
  }
}

type AltTitles = { alternateTitles?: Array<{ title?: string }> };

function namesOf(title: string, ...more: Array<string | undefined>): string[] {
  return [title, ...more].filter((name): name is string => typeof name === 'string' && name.trim().length > 0);
}

async function readArrTitles(mediaType: LibraryMediaType, keepTag: string, keepTagIds: Map<string, number | null>): Promise<ArrTitle[]> {
  const out: ArrTitle[] = [];
  if (mediaType === 'movie') {
    const instances = await getRadarrClients();
    if (instances.length === 0) throw new LibraryCleanupUnavailableError('No Radarr instance is connected.');
    for (const { connection, client } of instances) {
      const { items, keepTagId, downloading } = await readArrInstance<RadarrMovie>(
        'Radarr', connection, client, () => client.getMovies(), (r) => positive(r.movieId) ?? undefined, keepTag,
      );
      keepTagIds.set(connection.id, keepTagId);
      for (const movie of items) {
        out.push({
          connection,
          names: namesOf(movie.title, movie.originalTitle, ...((movie as AltTitles).alternateTitles ?? []).map((a) => a.title)),
          facts: {
            mediaType: 'movie',
            service: 'RADARR',
            instanceId: connection.id,
            instanceLabel: connection.label,
            arrId: movie.id,
            title: movie.title,
            year: positive(movie.year),
            tmdbId: positive(movie.tmdbId),
            tvdbId: null,
            imdbId: movie.imdbId || null,
            posterUrl: posterOf(movie.images),
            sizeBytes: Number(movie.sizeOnDisk) || 0,
            added: movie.added ?? null,
            rating: movieRating(movie),
            keepTagged: keepTagId !== null && (movie.tags ?? []).includes(keepTagId),
            downloading: downloading.has(movie.id),
          },
        });
      }
    }
  } else {
    const instances = await getSonarrClients();
    if (instances.length === 0) throw new LibraryCleanupUnavailableError('No Sonarr instance is connected.');
    for (const { connection, client } of instances) {
      const { items, keepTagId, downloading } = await readArrInstance<SonarrSeries>(
        'Sonarr', connection, client, () => client.getSeries(), (r) => positive(r.seriesId) ?? undefined, keepTag,
      );
      keepTagIds.set(connection.id, keepTagId);
      for (const series of items) {
        const rating = series.ratings?.value;
        out.push({
          connection,
          names: namesOf(series.title, ...((series as AltTitles).alternateTitles ?? []).map((a) => a.title)),
          facts: {
            mediaType: 'series',
            service: 'SONARR',
            instanceId: connection.id,
            instanceLabel: connection.label,
            arrId: series.id,
            title: series.title,
            year: positive(series.year),
            tmdbId: positive(series.tmdbId),
            tvdbId: positive(series.tvdbId),
            imdbId: series.imdbId || null,
            posterUrl: posterOf(series.images),
            sizeBytes: Number(series.statistics?.sizeOnDisk) || 0,
            added: series.added ?? null,
            rating: typeof rating === 'number' && rating > 0 ? rating : null,
            keepTagged: keepTagId !== null && (series.tags ?? []).includes(keepTagId),
            downloading: downloading.has(series.id),
          },
        });
      }
    }
  }
  return out;
}

/** IMDb first, then TMDB: both are 0–10. */
function movieRating(movie: RadarrMovie): number | null {
  const value = movie.ratings?.imdb?.value || movie.ratings?.tmdb?.value;
  return typeof value === 'number' && value > 0 ? value : null;
}

// ── Jellyfin ────────────────────────────────────────────────────────────────

interface WatchState {
  lastWatchedAt: Date | null;
  watchedWithoutDate: boolean;
}

function itemsOf(response: JellyfinItemsResponse | undefined, what: string): JellyfinItem[] {
  if (!response || !Array.isArray(response.Items)) fail(`Jellyfin ${what}`);
  // Without a Limit Jellyfin returns everything; fewer items than it reports is a truncated read.
  if (typeof response.TotalRecordCount === 'number' && response.Items.length < response.TotalRecordCount) {
    fail(`Jellyfin ${what} (incomplete)`);
  }
  return response.Items;
}

function addPlay(map: Map<string, WatchState>, key: string, item: JellyfinItem, fromPlayedFilter: boolean) {
  const data = item.UserData;
  const played = fromPlayedFilter || Boolean(data?.Played) || (data?.PlayCount ?? 0) > 0 || (data?.PlaybackPositionTicks ?? 0) > 0;
  const at = data?.LastPlayedDate ? new Date(data.LastPlayedDate) : null;
  const validAt = at && Number.isFinite(at.getTime()) ? at : null;
  if (!played && !validAt) return;
  const state = map.get(key) ?? { lastWatchedAt: null, watchedWithoutDate: false };
  if (validAt) {
    if (!state.lastWatchedAt || validAt > state.lastWatchedAt) state.lastWatchedAt = validAt;
  } else {
    state.watchedWithoutDate = true;
  }
  map.set(key, state);
}

const PLAY_PAGE = 500;
const MAX_PLAY_PAGES = 200;

/**
 * Every play by one Jellyfin user: everything marked played (also catches a
 * play Jellyfin kept no date for), everything partly watched, and every item with a play date,
 * newest first, paged until the first undated item. The dated scan is what
 * catches a play in progress or stopped early: Jellyfin counts it (PlayCount,
 * LastPlayedDate) without marking it played or resumable.
 */
async function readUserPlays(client: JellyfinClient, playType: string, userName: string): Promise<Array<{ item: JellyfinItem; fromPlayedFilter: boolean }>> {
  const out: Array<{ item: JellyfinItem; fromPlayedFilter: boolean }> = [];
  const played = await client.queryItems({ IncludeItemTypes: playType, Recursive: true, Filters: 'IsPlayed', EnableUserData: true, EnableImages: false });
  for (const item of itemsOf(played, `plays for ${userName}`)) out.push({ item, fromPlayedFilter: true });
  // Partly watched ones too, so they never depend on the scan's sort order alone.
  const resumable = await client.queryItems({ IncludeItemTypes: playType, Recursive: true, Filters: 'IsResumable', EnableUserData: true, EnableImages: false });
  for (const item of itemsOf(resumable, `plays for ${userName}`)) out.push({ item, fromPlayedFilter: false });
  for (let page = 0; page < MAX_PLAY_PAGES; page++) {
    const response = await client.queryItems({
      IncludeItemTypes: playType,
      Recursive: true,
      SortBy: 'DatePlayed',
      SortOrder: 'Descending',
      StartIndex: page * PLAY_PAGE,
      Limit: PLAY_PAGE,
      EnableUserData: true,
      EnableImages: false,
    });
    if (!response || !Array.isArray(response.Items)) fail(`Jellyfin plays for ${userName}`);
    for (const item of response.Items) {
      if (!item.UserData?.LastPlayedDate) return out;
      out.push({ item, fromPlayedFilter: false });
    }
    const total = typeof response.TotalRecordCount === 'number' ? response.TotalRecordCount : null;
    if (response.Items.length < PLAY_PAGE) {
      if (total !== null && (page * PLAY_PAGE + response.Items.length) < total) fail(`Jellyfin plays for ${userName} (incomplete)`);
      return out;
    }
  }
  fail(`Jellyfin plays for ${userName} (too many pages)`);
}

/**
 * Plays by every Jellyfin user (not only those linked to Helprr), keyed by the
 * Jellyfin movie or series id, plus the provider-id index of the library as
 * every user sees it (a library one user cannot see is still indexed). What is
 * playing right now counts as watched now.
 */
async function readJellyfin(mediaType: LibraryMediaType, now: number): Promise<{
  byProvider: Map<string, string[]>;
  plays: Map<string, WatchState>;
}> {
  let context: Awaited<ReturnType<typeof getJellyfinClientContext>>;
  try {
    context = await getJellyfinClientContext();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      throw new LibraryCleanupUnavailableError('Jellyfin is not connected, so watch history cannot be checked. Nothing was changed.');
    }
    fail('Jellyfin', error);
  }
  const { client, connection } = context;
  const headers = getConnectionHeaders(connection);
  let admin: boolean;
  try {
    admin = await client.hasAdminAccess();
  } catch (error) {
    fail('Jellyfin', error);
  }
  if (!admin) {
    // A non-admin token lists only its own user and sessions: other people's plays would be missed.
    throw new LibraryCleanupUnavailableError(
      'The Jellyfin connection is not an administrator (or Jellyfin refused its key), so other people’s watch history cannot be read. Use an API key or an admin account for the Jellyfin connection. Nothing was changed.',
    );
  }
  try {
    const libraryType = mediaType === 'movie' ? 'Movie' : 'Series';
    const playType = mediaType === 'movie' ? 'Movie' : 'Episode';
    const [users, sessions] = await Promise.all([client.getUsers(), client.getSessions()]);
    if (!Array.isArray(users) || users.length === 0) fail('Jellyfin users');
    if (!Array.isArray(sessions)) fail('Jellyfin sessions');

    const byProvider = new Map<string, Set<string>>();
    const plays = new Map<string, WatchState>();
    for (const user of users) {
      const userClient = new JellyfinClient(connection.url, connection.apiKey, user.Id, headers);
      const library = await userClient.queryItems({ IncludeItemTypes: libraryType, Recursive: true, Fields: 'ProviderIds', EnableUserData: false, EnableImages: false });
      for (const item of itemsOf(library, `library for ${user.Name}`)) {
        const ids = item.ProviderIds ?? {};
        for (const [provider, value] of [['tmdb', ids.Tmdb], ['tvdb', ids.Tvdb], ['imdb', ids.Imdb?.toLowerCase()]] as const) {
          if (!value) continue;
          const key = `${provider}:${value}`;
          byProvider.set(key, (byProvider.get(key) ?? new Set()).add(item.Id));
        }
      }
      for (const { item, fromPlayedFilter } of await readUserPlays(userClient, playType, user.Name)) {
        const key = mediaType === 'movie' ? item.Id : item.SeriesId;
        if (key) addPlay(plays, key, item, fromPlayedFilter);
      }
    }
    for (const session of sessions) {
      const playing = session.NowPlayingItem;
      const key = playing && (mediaType === 'movie' ? (playing.Type === 'Movie' ? playing.Id : null) : playing.SeriesId);
      if (key) addPlay(plays, key, { ...playing, UserData: { ...playing.UserData, LastPlayedDate: new Date(now).toISOString() } } as JellyfinItem, false);
    }
    return { byProvider: new Map([...byProvider].map(([k, v]) => [k, [...v]])), plays };
  } catch (error) {
    if (error instanceof LibraryCleanupUnavailableError) throw error;
    fail('Jellyfin', error);
  }
}

function jellyfinIdsFor(t: ArrTitle['facts'], byProvider: Map<string, string[]>): string[] {
  const keys = [
    t.tmdbId ? `tmdb:${t.tmdbId}` : null,
    t.tvdbId ? `tvdb:${t.tvdbId}` : null,
    t.imdbId ? `imdb:${t.imdbId.toLowerCase()}` : null,
  ].filter((key): key is string => key !== null);
  // Every match counts (a title can exist twice in Jellyfin); a play on any of them protects it.
  return [...new Set(keys.flatMap((key) => byProvider.get(key) ?? []))];
}

// ── Requests ────────────────────────────────────────────────────────────────

interface RequestRecord {
  tmdbId: number | null;
  tvdbId: number | null;
  /** The requested title's name, when known; null means "could be any title". */
  title: string | null;
  /** The TVDB id came from Seerr's TV details (TMDB's mapping), not from the request itself. */
  tvdbFromDetails?: boolean;
  open: boolean;
  at: Date | null;
  name: string;
  helprrUserId: string | null;
}

const SEERR_PAGE = 100;
const MAX_SEERR_PAGES = 200;

async function readSeerrRequests(warnings: string[]): Promise<{ client: Awaited<ReturnType<typeof getSeerrClient>> | null; requests: SeerrRequest[] }> {
  let client: Awaited<ReturnType<typeof getSeerrClient>>;
  try {
    client = await getSeerrClient();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      warnings.push('Seerr is not connected, so only requests made in Helprr were checked. Delete now needs Seerr.');
      return { client: null, requests: [] };
    }
    fail('Seerr', error);
  }
  // By id: a request added while paging shifts the pages, so one can be read twice.
  const all = new Map<number, SeerrRequest>();
  try {
    for (let page = 0; page < MAX_SEERR_PAGES; page++) {
      const response = await client.listRequests({ take: SEERR_PAGE, skip: page * SEERR_PAGE, filter: 'all', sort: 'added' });
      if (!response || !Array.isArray(response.results)) fail('Seerr requests');
      for (const request of response.results) all.set(request.id, request);
      const total = response.pageInfo?.results;
      if (typeof total === 'number' && all.size >= total) return { client, requests: [...all.values()] };
      if (response.results.length < SEERR_PAGE) {
        if (typeof total === 'number' && all.size < total) fail('Seerr requests (incomplete)');
        return { client, requests: [...all.values()] };
      }
    }
  } catch (error) {
    if (error instanceof LibraryCleanupUnavailableError) throw error;
    fail('Seerr requests', error);
  }
  fail('Seerr requests (too many pages)');
}

function requesterName(request: SeerrRequest): string {
  const by = request.requestedBy;
  return by?.displayName || by?.username || by?.jellyfinUsername || by?.email || `Seerr user ${by?.id ?? '?'}`;
}

/**
 * Every request for this library type, open or not. `titlesWithoutTmdb` says
 * whether some library title has no TMDB id: a request Seerr knows only by
 * TMDB id cannot be compared with it by id, so its name is looked up.
 */
async function readRequests(mediaType: LibraryMediaType, warnings: string[], titlesWithoutTmdb: boolean): Promise<{
  records: RequestRecord[];
  seerrConnected: boolean;
}> {
  const seerrType = mediaType === 'movie' ? 'movie' : 'tv';
  const [seerr, pending, linkedUsers] = await Promise.all([
    readSeerrRequests(warnings),
    prisma.pendingRequest.findMany({
      where: { mediaType: seerrType },
      select: { tmdbId: true, title: true, createdAt: true, userId: true, user: { select: { displayName: true } } },
    }),
    prisma.user.findMany({ where: { seerrUserId: { not: null } }, select: { id: true, seerrUserId: true } }),
  ]);
  const userBySeerrId = new Map(linkedUsers.map((u) => [u.seerrUserId!, u.id]));
  const records: RequestRecord[] = [];

  for (const request of seerr.requests) {
    if (request.type !== seerrType || !request.media) continue;
    const tmdbId = positive(request.media.tmdbId);
    const tvdbId = positive(request.media.tvdbId);
    // Declined and completed requests are finished, and so is an approved one Seerr
    // shows fully available (in the quality asked for). One waiting for approval is
    // always open. A partly available series stays open: someone is still waiting.
    const available = (request.is4k ? request.media.status4k : request.media.status) === SEERR_MEDIA_STATUS.AVAILABLE;
    const finished = request.status === SEERR_REQUEST_STATUS.DECLINED
      || request.status === SEERR_REQUEST_STATUS.COMPLETED
      || (request.status !== SEERR_REQUEST_STATUS.PENDING_APPROVAL && available);
    let title: string | null = null;
    let detailTvdbId: number | null = null;
    if (titlesWithoutTmdb && tmdbId && !tvdbId && seerr.client) {
      // The TV details carry the TVDB id (compared by id then) and the name. A failed
      // lookup leaves both unknown, which protects every title it cannot be told apart from.
      const detail = await getCachedSeerrMediaDetail(seerr.client, seerrType, tmdbId);
      detailTvdbId = positive((detail as { externalIds?: { tvdbId?: unknown } } | null)?.externalIds?.tvdbId);
      title = detail?.name || detail?.title || null;
    }
    records.push({
      tmdbId,
      tvdbId: tvdbId ?? detailTvdbId,
      tvdbFromDetails: !tvdbId && detailTvdbId !== null,
      title,
      open: !finished,
      at: request.createdAt ? new Date(request.createdAt) : null,
      name: requesterName(request),
      helprrUserId: request.requestedBy ? userBySeerrId.get(String(request.requestedBy.id)) ?? null : null,
    });
  }
  // Helprr's own requests waiting to be sent to Seerr are open by definition.
  for (const request of pending) {
    records.push({
      tmdbId: positive(request.tmdbId),
      tvdbId: null,
      title: request.title?.trim() || null,
      open: true,
      at: request.createdAt,
      name: request.user?.displayName ?? 'A Helprr user',
      helprrUserId: request.userId,
    });
  }
  return { records, seerrConnected: seerr.client !== null };
}

/**
 * Whether a request is for this title. By id when both sides have one to
 * compare; otherwise by name, and a request with no known name is assumed to
 * be for it (fail closed: it can only keep a title).
 */
function requestIsFor(r: RequestRecord & { loose: string[] | null }, t: ArrTitle['facts'], names: Set<string>): boolean {
  const byTmdb = r.tmdbId !== null && t.tmdbId !== null;
  const byTvdb = r.tvdbId !== null && t.tvdbId !== null;
  if (byTmdb || byTvdb) {
    if ((byTmdb && r.tmdbId === t.tmdbId) || (byTvdb && r.tvdbId === t.tvdbId)) return true;
    // TMDB's TVDB mapping can point at another TVDB entry than Sonarr's (anime is often
    // split differently), so for an id from Seerr's details the name still counts.
    if (!r.tvdbFromDetails) return false;
  }
  return r.loose === null || r.loose.some((form) => names.has(form));
}

// ── Watchlists ──────────────────────────────────────────────────────────────

/** Loose title form: case, accents, punctuation and spacing ignored. */
function looseTitle(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Every loose form of a name: as is, and without a trailing "(2024)" / "(US)"
 * or year, which TVDB and TMDB add or leave off ("Shōgun (2024)" vs "Shōgun").
 */
function looseForms(value: string): string[] {
  const forms = [value, value.replace(/\s*\([^()]*\)\s*$/, ''), value.replace(/\s+(19|20)\d{2}\s*$/, '')];
  return [...new Set(forms.map(looseTitle).filter(Boolean))];
}

async function readWatchlists(mediaType: LibraryMediaType, arrTitles: ArrTitle[]): Promise<Map<string, Set<string>>> {
  const items = await prisma.watchlistItem.findMany({
    where: { userId: { not: null }, mediaType: mediaType === 'movie' ? { in: ['movie', 'anime'] } : { in: ['series', 'anime'] } },
    select: { userId: true, source: true, externalId: true, mediaType: true, title: true },
  });
  const anilistBySeries = mediaType === 'series' ? await loadAnilistIdsBySeries() : new Map<string, number[]>();
  const out = new Map<string, Set<string>>();
  for (const { facts: t, names } of arrTitles) {
    const anilistIds = anilistBySeries.get(`${t.instanceId}:${t.arrId}`) ?? [];
    const loose = new Set(names.flatMap(looseForms));
    for (const item of items) {
      // A TMDB/TVDB save the title has no such id for cannot be compared by id:
      // match by name instead, and a save with no usable name keeps the title.
      const idUncomparable = (item.source === 'TMDB' && t.tmdbId === null) || (item.source === 'TVDB' && t.tvdbId === null);
      const itemForms = looseForms(item.title);
      const byName = () => itemForms.length === 0 || itemForms.some((form) => loose.has(form));
      const hit = item.source === 'ANILIST'
        // An AniList save matches its mapped Sonarr series, or any name the arr knows
        // the title by (AniList movies have no mapping). Errs towards keeping.
        ? anilistIds.includes(Number(item.externalId)) || itemForms.some((form) => loose.has(form))
        : idUncomparable ? byName() : watchlistItemMatches(item, {
          kind: t.mediaType,
          instanceId: t.instanceId,
          arrId: t.arrId,
          // Treat a library-id save as a match on every instance: a false match only keeps a title.
          soleInstance: true,
          title: t.title,
          tmdbId: t.tmdbId ?? undefined,
          tvdbId: t.tvdbId ?? undefined,
        });
      if (!hit) continue;
      const key = titleKey(t);
      out.set(key, (out.get(key) ?? new Set()).add(item.userId!));
    }
  }
  return out;
}

// ── All together ────────────────────────────────────────────────────────────

export async function gatherLibraryFacts(mediaType: LibraryMediaType, keepTag: string, now = Date.now()): Promise<GatheredFacts> {
  const warnings: string[] = [];
  const keepTagIds = new Map<string, number | null>();
  const arrTitles = await readArrTitles(mediaType, keepTag, keepTagIds);
  const [jellyfin, requests] = await Promise.all([
    readJellyfin(mediaType, now),
    readRequests(mediaType, warnings, arrTitles.some((t) => t.facts.tmdbId === null)),
  ]);
  const records = requests.records.map((r) => {
    const forms = r.title ? looseForms(r.title) : [];
    return { ...r, loose: forms.length > 0 ? forms : null };
  });
  const facts = arrTitles.map((t) => t.facts);
  const watchlists = await readWatchlists(mediaType, arrTitles);

  const namesByKey = new Map(arrTitles.map((t) => [titleKey(t.facts), new Set(t.names.flatMap(looseForms))]));
  const titles = facts.map((t): TitleFacts => {
    const jellyfinIds = jellyfinIdsFor(t, jellyfin.byProvider);
    let lastWatchedAt: Date | null = null;
    let watchedWithoutDate = false;
    for (const id of jellyfinIds) {
      const play = jellyfin.plays.get(id);
      if (!play) continue;
      if (play.lastWatchedAt && (!lastWatchedAt || play.lastWatchedAt > lastWatchedAt)) lastWatchedAt = play.lastWatchedAt;
      watchedWithoutDate ||= play.watchedWithoutDate;
    }
    const names = namesByKey.get(titleKey(t)) ?? new Set<string>();
    const mine = records.filter((r) => requestIsFor(r, t, names));
    const latestRequestAt = mine.reduce<Date | null>(
      (latest, r) => (r.at && Number.isFinite(r.at.getTime()) && (!latest || r.at > latest) ? r.at : latest), null,
    );
    return {
      ...t,
      inJellyfin: jellyfinIds.length > 0,
      jellyfinIds,
      lastWatchedAt,
      watchedWithoutDate,
      watchlistUserIds: [...(watchlists.get(titleKey(t)) ?? [])],
      openRequest: mine.some((r) => r.open),
      latestRequestAt,
      requestedBy: [...new Set(mine.map((r) => r.name))],
      requesterUserIds: [...new Set(mine.map((r) => r.helprrUserId).filter((id): id is string => id !== null))],
    };
  });
  return { titles, keepTagIds, seerrConnected: requests.seerrConnected, warnings };
}
