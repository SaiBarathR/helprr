import { filmReleases, isFilmNotReleased, validDate } from '@/lib/film-releases';

export type WantedSource = 'sonarr' | 'radarr' | 'lidarr';
export type WantedType = 'missing' | 'cutoff';

export interface WantedRecord {
  id: number;
  source: WantedSource;
  instanceId?: string;
  instanceLabel?: string;
  mediaType: 'episode' | 'movie' | 'album';
  title?: string;
  seriesId?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  airDateUtc?: string;
  airDate?: string;
  series?: { id: number; title: string };
  year?: number;
  added?: string;
  monitored?: boolean;
  // Radarr movie fields
  status?: string;
  isAvailable?: boolean;
  inCinemas?: string;
  digitalRelease?: string;
  physicalRelease?: string;
  // Lidarr album fields
  artistId?: number;
  albumId?: number;
  releaseDate?: string;
  artist?: { id: number; artistName: string };
}

// Row identity for list keys and per-item search state: multi-instance setups
// can repeat a (source, id) pair, so the instance must be part of the key.
export function wantedRecordKey(record: WantedRecord): string {
  return `${record.source}-${record.instanceId ?? 'default'}-${record.id}`;
}

/** A Radarr film that is not out anywhere yet (see isFilmNotReleased). */
export function isNotReleased(record: WantedRecord, now = Date.now()): boolean {
  return record.source === 'radarr' && isFilmNotReleased(record, now);
}

/**
 * The date a row shows, named for what it means: an episode's air date, an
 * album's release date, a film's cinema/digital/physical release (or the date
 * it was added when Radarr has no release dates for it).
 */
export function wantedDate(record: WantedRecord, now = Date.now()): { label: string; date: Date } | null {
  if (record.mediaType === 'episode') {
    const date = validDate(record.airDateUtc || record.airDate);
    return date && { label: date.getTime() > now ? 'Airs' : 'Aired', date };
  }
  if (record.mediaType === 'album') {
    const date = validDate(record.releaseDate);
    return date && { label: date.getTime() > now ? 'Releases' : 'Released', date };
  }

  const { past, future } = filmReleases(record, now);
  // Out: the first home release, else the cinema release. Not out yet: the next release.
  const pick = past.find((r) => r.label !== 'In cinemas') ?? past[0] ?? future[0];
  if (pick) return pick;
  const added = validDate(record.added);
  return added && { label: 'Added', date: added };
}

export type SearchRequest = { url: string; body: Record<string, unknown>; count: number };

function commandUrl(source: WantedSource, instanceId: string | undefined): string {
  return `/api/${source}/command${instanceId ? `?instanceId=${encodeURIComponent(instanceId)}` : ''}`;
}

function itemSearchBody(source: WantedSource, ids: number[]): Record<string, unknown> {
  if (source === 'sonarr') return { name: 'EpisodeSearch', episodeIds: ids };
  if (source === 'lidarr') return { name: 'AlbumSearch', albumIds: ids };
  return { name: 'MoviesSearch', movieIds: ids };
}

/** One search command per (app, instance): item ids only mean something on their own instance. */
export function selectedSearchRequests(records: WantedRecord[]): SearchRequest[] {
  const groups = new Map<string, { source: WantedSource; instanceId?: string; ids: number[] }>();
  for (const record of records) {
    const key = `${record.source}:${record.instanceId ?? ''}`;
    const group = groups.get(key) ?? { source: record.source, instanceId: record.instanceId, ids: [] };
    group.ids.push(record.id);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ source, instanceId, ids }) => ({
    url: commandUrl(source, instanceId),
    body: itemSearchBody(source, ids),
    count: ids.length,
  }));
}

const SEARCH_ALL_COMMAND: Record<WantedSource, Record<WantedType, string>> = {
  sonarr: { missing: 'MissingEpisodeSearch', cutoff: 'CutoffUnmetEpisodeSearch' },
  radarr: { missing: 'MissingMoviesSearch', cutoff: 'CutoffUnmetMoviesSearch' },
  lidarr: { missing: 'MissingAlbumSearch', cutoff: 'CutoffUnmetAlbumSearch' },
};

export type WantedInstance = { id: string; source: WantedSource };

/** The instances the tab's app and instance filters cover (no apps picked = every app). */
export function searchAllTargets(
  instances: WantedInstance[],
  filterBy: string[],
  instanceFilter: string,
): WantedInstance[] {
  return instances.filter((instance) =>
    (filterBy.length === 0 || filterBy.includes(instance.source))
    && (instanceFilter === 'all' || instance.id === instanceFilter));
}

export type SearchResult = { ok: boolean; data?: unknown };
export type SearchAllOutcome = { tone: 'success' | 'info' | 'warning' | 'error'; message: string };

/** Radarr's Missing answer: how many released films it found, queued and could not queue. */
function filmSearch(data: unknown): { movieCount: number; queued: number; notQueued: number } | null {
  if (!data || typeof data !== 'object') return null;
  const { movieCount, queued, notQueued } = data as Record<string, unknown>;
  return typeof movieCount === 'number' && typeof queued === 'number' && typeof notQueued === 'number'
    ? { movieCount, queued, notQueued }
    : null;
}

const films = (n: number) => (n === 1 ? '1 film' : `${n} films`);

/**
 * Search all's confirm heading, counting what is searched. On Missing, Radarr
 * is asked only for the films that are out (`skipsUnreleased`), so the films
 * not released yet are left out of the count; until every page is loaded their
 * number is unknown, and the heading gives none.
 */
export function searchAllTitle({ listName, totalRecords, notReleased, allLoaded, skipsUnreleased }: {
  listName: string;
  totalRecords: number;
  /** The loaded rows that are films not released yet. */
  notReleased: number;
  allLoaded: boolean;
  skipsUnreleased: boolean;
}): string {
  const items = (n: number) => `${n} ${listName} ${n === 1 ? 'item' : 'items'}`;
  if (!skipsUnreleased) return `Search for all ${items(totalRecords)}?`;
  if (!allLoaded) return `Search for every ${listName} item that is out?`;
  const searched = Math.max(0, totalRecords - notReleased);
  if (searched === totalRecords) return `Search for all ${items(totalRecords)}?`;
  return `Search for the ${items(searched)} that ${searched === 1 ? 'is' : 'are'} out?`;
}

/** The toast for a Search all, one result per instance it was sent to. */
export function searchAllOutcome(listName: string, results: SearchResult[]): SearchAllOutcome {
  const accepted = results.filter((r) => r.ok);
  const failed = results.length - accepted.length;
  if (accepted.length === 0) return { tone: 'error', message: 'Search failed' };
  const instancesNote = failed > 0 ? ` Search failed on ${failed} of ${results.length} instances.` : '';

  const filmResults = accepted.map((r) => filmSearch(r.data)).filter((f) => f !== null);
  const queued = filmResults.reduce((sum, f) => sum + f.queued, 0);
  const notQueued = filmResults.reduce((sum, f) => sum + f.notQueued, 0);
  if (notQueued > 0) {
    return { tone: 'warning', message: `Searching ${films(queued)}; ${notQueued} could not be queued.${instancesNote}` };
  }
  // Every instance that answered was a Radarr with nothing out to search.
  if (filmResults.length === accepted.length && queued === 0) {
    return { tone: failed > 0 ? 'error' : 'info', message: `No released films are missing.${instancesNote}` };
  }
  return failed === 0
    ? { tone: 'success', message: `Searching for every ${listName} item` }
    : { tone: 'error', message: `Search started on ${accepted.length} of ${results.length} instances` };
}

/** One "search everything on this list" command per instance. */
export function searchAllRequests(type: WantedType, targets: WantedInstance[]): SearchRequest[] {
  return targets.map(({ id, source }) => ({
    url: commandUrl(source, id),
    body: { name: SEARCH_ALL_COMMAND[source][type] },
    count: 1,
  }));
}
