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

function validDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

type FilmRelease = { label: 'In cinemas' | 'Digital release' | 'Physical release'; date: Date };

/**
 * A film's known releases, oldest first, split into those that have happened
 * and those still to come. The one place the Missing tab decides whether a
 * film is out: the "Not released yet" group and the row's date both read it.
 */
function filmReleases(record: WantedRecord, now: number): { past: FilmRelease[]; future: FilmRelease[] } {
  const releases = ([
    ['In cinemas', record.inCinemas],
    ['Digital release', record.digitalRelease],
    ['Physical release', record.physicalRelease],
  ] as const)
    .map(([label, value]) => ({ label, date: validDate(value) }))
    .filter((r): r is FilmRelease => r.date !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  return {
    past: releases.filter((r) => r.date.getTime() <= now),
    future: releases.filter((r) => r.date.getTime() > now),
  };
}

/**
 * A Radarr film that is not out anywhere yet: none of its cinema, digital or
 * physical dates has passed (with no dates at all: Radarr's status says it is
 * only announced). Radarr's own isAvailable is not used: with minimum
 * availability "announced" it is true for films years from release.
 */
export function isNotReleased(record: WantedRecord, now = Date.now()): boolean {
  if (record.source !== 'radarr') return false;
  const { past, future } = filmReleases(record, now);
  if (past.length > 0) return false;
  return future.length > 0 || record.status === 'announced' || record.status === 'tba';
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

/** One "search everything on this list" command per instance. */
export function searchAllRequests(type: WantedType, targets: WantedInstance[]): SearchRequest[] {
  return targets.map(({ id, source }) => ({
    url: commandUrl(source, id),
    body: { name: SEARCH_ALL_COMMAND[source][type] },
    count: 1,
  }));
}
