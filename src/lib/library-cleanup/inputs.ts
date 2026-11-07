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
 * Every play by one Jellyfin user. Two reads: everything marked played (also
 * catches a play Jellyfin kept no date for), and every item with a play date,
 * newest first, paged until the first undated item. The second one is what
 * catches a play in progress or stopped early: Jellyfin counts it (PlayCount,
 * LastPlayedDate) without marking it played or resumable.
 */
async function readUserPlays(client: JellyfinClient, playType: string, userName: string): Promise<Array<{ item: JellyfinItem; fromPlayedFilter: boolean }>> {
  const out: Array<{ item: JellyfinItem; fromPlayedFilter: boolean }> = [];
  const played = await client.queryItems({ IncludeItemTypes: playType, Recursive: true, Filters: 'IsPlayed', EnableUserData: true, EnableImages: false });
  for (const item of itemsOf(played, `plays for ${userName}`)) out.push({ item, fromPlayedFilter: true });
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

interface RequestState {
  open: boolean;
  latestAt: Date | null;
  requestedBy: Set<string>;
  helprrUserIds: Set<string>;
}

const SEERR_PAGE = 100;
const MAX_SEERR_PAGES = 200;

async function readSeerrRequests(warnings: string[]): Promise<SeerrRequest[]> {
  let client: Awaited<ReturnType<typeof getSeerrClient>>;
  try {
    client = await getSeerrClient();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      warnings.push('Seerr is not connected, so only requests made in Helprr were checked.');
      return [];
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
      if (typeof total === 'number' && all.size >= total) return [...all.values()];
      if (response.results.length < SEERR_PAGE) {
        if (typeof total === 'number' && all.size < total) fail('Seerr requests (incomplete)');
        return [...all.values()];
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

async function readRequests(mediaType: LibraryMediaType, warnings: string[]): Promise<Map<string, RequestState>> {
  const seerrType = mediaType === 'movie' ? 'movie' : 'tv';
  const [seerr, pending, linkedUsers] = await Promise.all([
    readSeerrRequests(warnings),
    prisma.pendingRequest.findMany({
      where: { mediaType: seerrType },
      select: { tmdbId: true, createdAt: true, userId: true, user: { select: { displayName: true } } },
    }),
    prisma.user.findMany({ where: { seerrUserId: { not: null } }, select: { id: true, seerrUserId: true } }),
  ]);
  const userBySeerrId = new Map(linkedUsers.map((u) => [u.seerrUserId!, u.id]));
  const map = new Map<string, RequestState>();
  const stateFor = (key: string) => {
    let state = map.get(key);
    if (!state) {
      state = { open: false, latestAt: null, requestedBy: new Set(), helprrUserIds: new Set() };
      map.set(key, state);
    }
    return state;
  };
  const note = (keys: string[], open: boolean, at: Date | null, name: string, helprrUserId: string | null) => {
    for (const key of keys) {
      const state = stateFor(key);
      state.open ||= open;
      if (at && Number.isFinite(at.getTime()) && (!state.latestAt || at > state.latestAt)) state.latestAt = at;
      state.requestedBy.add(name);
      if (helprrUserId) state.helprrUserIds.add(helprrUserId);
    }
  };

  for (const request of seerr) {
    if (request.type !== seerrType || !request.media) continue;
    const keys = [
      positive(request.media.tmdbId) ? `tmdb:${request.media.tmdbId}` : null,
      positive(request.media.tvdbId) ? `tvdb:${request.media.tvdbId}` : null,
    ].filter((key): key is string => key !== null);
    // Declined and completed requests are finished, and so is an approved one Seerr
    // shows fully available (in the quality asked for). One waiting for approval is
    // always open. A partly available series stays open: someone is still waiting.
    const available = (request.is4k ? request.media.status4k : request.media.status) === SEERR_MEDIA_STATUS.AVAILABLE;
    const finished = request.status === SEERR_REQUEST_STATUS.DECLINED
      || request.status === SEERR_REQUEST_STATUS.COMPLETED
      || (request.status !== SEERR_REQUEST_STATUS.PENDING_APPROVAL && available);
    const helprrUser = request.requestedBy ? userBySeerrId.get(String(request.requestedBy.id)) ?? null : null;
    note(keys, !finished, request.createdAt ? new Date(request.createdAt) : null, requesterName(request), helprrUser);
  }
  // Helprr's own requests waiting to be sent to Seerr are open by definition.
  for (const request of pending) {
    note([`tmdb:${request.tmdbId}`], true, request.createdAt, request.user?.displayName ?? 'A Helprr user', request.userId);
  }
  return map;
}

function requestKeys(t: ArrTitle['facts']): string[] {
  return [t.tmdbId ? `tmdb:${t.tmdbId}` : null, t.tvdbId ? `tvdb:${t.tvdbId}` : null]
    .filter((key): key is string => key !== null);
}

// ── Watchlists ──────────────────────────────────────────────────────────────

/** Loose title form: case, accents, punctuation and spacing ignored. */
function looseTitle(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
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
    const loose = new Set(names.map(looseTitle).filter(Boolean));
    for (const item of items) {
      const hit = item.source === 'ANILIST'
        // An AniList save matches its mapped Sonarr series, or any name the arr knows
        // the title by (AniList movies have no mapping). Errs towards keeping.
        ? anilistIds.includes(Number(item.externalId)) || loose.has(looseTitle(item.title))
        : watchlistItemMatches(item, {
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
    readRequests(mediaType, warnings),
  ]);
  const facts = arrTitles.map((t) => t.facts);
  const watchlists = await readWatchlists(mediaType, arrTitles);

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
    const requestStates = requestKeys(t).map((key) => requests.get(key)).filter((s): s is RequestState => Boolean(s));
    const latestRequestAt = requestStates.reduce<Date | null>(
      (latest, s) => (s.latestAt && (!latest || s.latestAt > latest) ? s.latestAt : latest), null,
    );
    return {
      ...t,
      inJellyfin: jellyfinIds.length > 0,
      lastWatchedAt,
      watchedWithoutDate,
      watchlistUserIds: [...(watchlists.get(titleKey(t)) ?? [])],
      openRequest: requestStates.some((s) => s.open),
      latestRequestAt,
      requestedBy: [...new Set(requestStates.flatMap((s) => [...s.requestedBy]))],
      requesterUserIds: [...new Set(requestStates.flatMap((s) => [...s.helprrUserIds]))],
    };
  });
  return { titles, keepTagIds, warnings };
}
