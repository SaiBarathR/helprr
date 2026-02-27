import type {
  HistoryItem,
  QualityProfile,
  RootFolder,
  SonarrEpisode,
  SonarrSeason,
  SonarrSeries,
  Tag,
} from '@/types';

export interface SeriesDetailSnapshot {
  series: SonarrSeries | null;
  episodes: SonarrEpisode[];
  qualityProfiles: QualityProfile[];
  rootFolders: RootFolder[];
  tags: Tag[];
  fetchedAt: number;
}

export interface SeasonDetailSnapshot {
  series: SonarrSeries | null;
  episodes: SonarrEpisode[];
  fetchedAt: number;
}

export interface EpisodeDetailSnapshot {
  series: SonarrSeries | null;
  episode: SonarrEpisode | null;
  history: HistoryItem[];
  fetchedAt: number;
}

interface SnapshotInput {
  fetchedAt?: number;
}

const MAX_ENTRIES = 100;
const seriesDetailCache = new Map<number, SeriesDetailSnapshot>();
const seasonDetailCache = new Map<string, SeasonDetailSnapshot>();
const episodeDetailCache = new Map<string, EpisodeDetailSnapshot>();

function setWithLimit<K, V>(cache: Map<K, V>, key: K, value: V) {
  cache.set(key, value);
  if (cache.size <= MAX_ENTRIES) return;
  const oldestKey = cache.keys().next().value;
  if (oldestKey !== undefined) {
    cache.delete(oldestKey);
  }
}

function seasonKey(seriesId: number, seasonNumber: number) {
  return `${seriesId}:${seasonNumber}`;
}

function episodeKey(seriesId: number, episodeId: number) {
  return `${seriesId}:${episodeId}`;
}

function withFetchedAt<T extends SnapshotInput>(snapshot: T): T & { fetchedAt: number } {
  return {
    ...snapshot,
    fetchedAt: snapshot.fetchedAt ?? Date.now(),
  };
}

export function getSeriesDetailSnapshot(seriesId: number): SeriesDetailSnapshot | null {
  return seriesDetailCache.get(seriesId) ?? null;
}

export function setSeriesDetailSnapshot(
  seriesId: number,
  snapshot: Omit<SeriesDetailSnapshot, 'fetchedAt'> & SnapshotInput
) {
  setWithLimit(seriesDetailCache, seriesId, withFetchedAt(snapshot));
}

export function getSeasonDetailSnapshot(
  seriesId: number,
  seasonNumber: number
): SeasonDetailSnapshot | null {
  return seasonDetailCache.get(seasonKey(seriesId, seasonNumber)) ?? null;
}

export function setSeasonDetailSnapshot(
  seriesId: number,
  seasonNumber: number,
  snapshot: Omit<SeasonDetailSnapshot, 'fetchedAt'> & SnapshotInput
) {
  setWithLimit(seasonDetailCache, seasonKey(seriesId, seasonNumber), withFetchedAt(snapshot));
}

export function getEpisodeDetailSnapshot(
  seriesId: number,
  episodeId: number
): EpisodeDetailSnapshot | null {
  return episodeDetailCache.get(episodeKey(seriesId, episodeId)) ?? null;
}

export function setEpisodeDetailSnapshot(
  seriesId: number,
  episodeId: number,
  snapshot: Omit<EpisodeDetailSnapshot, 'fetchedAt'> & SnapshotInput
) {
  setWithLimit(episodeDetailCache, episodeKey(seriesId, episodeId), withFetchedAt(snapshot));
}

export function patchEpisodeAcrossSnapshots(
  seriesId: number,
  episodeId: number,
  updater: (episode: SonarrEpisode) => SonarrEpisode
) {
  patchEpisodesAcrossSnapshots(seriesId, [{ episodeId, updater }]);
}

export function patchEpisodesAcrossSnapshots(
  seriesId: number,
  updates: Array<{ episodeId: number; updater: (episode: SonarrEpisode) => SonarrEpisode }>
) {
  if (updates.length === 0) return;
  const updaterMap = new Map<number, (episode: SonarrEpisode) => SonarrEpisode>();
  for (const update of updates) {
    updaterMap.set(update.episodeId, update.updater);
  }

  const seriesSnapshot = seriesDetailCache.get(seriesId);
  if (seriesSnapshot) {
    let changed = false;
    const nextEpisodes = seriesSnapshot.episodes.map((episode) => {
      const episodeUpdater = updaterMap.get(episode.id);
      if (!episodeUpdater) return episode;
      changed = true;
      return episodeUpdater(episode);
    });
    if (changed) {
      setWithLimit(seriesDetailCache, seriesId, {
        ...seriesSnapshot,
        episodes: nextEpisodes,
        fetchedAt: Date.now(),
      });
    }
  }

  const seriesPrefix = `${seriesId}:`;
  for (const [key, snapshot] of seasonDetailCache.entries()) {
    if (!key.startsWith(seriesPrefix)) continue;
    let changed = false;
    const nextEpisodes = snapshot.episodes.map((episode) => {
      const episodeUpdater = updaterMap.get(episode.id);
      if (!episodeUpdater) return episode;
      changed = true;
      return episodeUpdater(episode);
    });
    if (changed) {
      setWithLimit(seasonDetailCache, key, {
        ...snapshot,
        episodes: nextEpisodes,
        fetchedAt: Date.now(),
      });
    }
  }

  for (const [episodeId, episodeUpdater] of updaterMap.entries()) {
    const snapshotKey = episodeKey(seriesId, episodeId);
    const episodeSnapshot = episodeDetailCache.get(snapshotKey);
    if (!episodeSnapshot?.episode) continue;
    setWithLimit(episodeDetailCache, snapshotKey, {
      ...episodeSnapshot,
      episode: episodeUpdater(episodeSnapshot.episode),
      fetchedAt: Date.now(),
    });
  }
}

export function patchSeasonAcrossSnapshots(
  seriesId: number,
  seasonNumber: number,
  updater: (season: SonarrSeason) => SonarrSeason
) {
  const seriesSnapshot = seriesDetailCache.get(seriesId);
  if (seriesSnapshot?.series) {
    setWithLimit(seriesDetailCache, seriesId, {
      ...seriesSnapshot,
      series: {
        ...seriesSnapshot.series,
        seasons: seriesSnapshot.series.seasons.map((season) =>
          season.seasonNumber === seasonNumber ? updater(season) : season
        ),
      },
      fetchedAt: Date.now(),
    });
  }

  const seasonSnapshotKey = seasonKey(seriesId, seasonNumber);
  const seasonSnapshot = seasonDetailCache.get(seasonSnapshotKey);
  if (seasonSnapshot?.series) {
    setWithLimit(seasonDetailCache, seasonSnapshotKey, {
      ...seasonSnapshot,
      series: {
        ...seasonSnapshot.series,
        seasons: seasonSnapshot.series.seasons.map((season) =>
          season.seasonNumber === seasonNumber ? updater(season) : season
        ),
      },
      fetchedAt: Date.now(),
    });
  }

  const seriesPrefix = `${seriesId}:`;
  for (const [key, snapshot] of episodeDetailCache.entries()) {
    if (!key.startsWith(seriesPrefix) || !snapshot.series) continue;
    setWithLimit(episodeDetailCache, key, {
      ...snapshot,
      series: {
        ...snapshot.series,
        seasons: snapshot.series.seasons.map((season) =>
          season.seasonNumber === seasonNumber ? updater(season) : season
        ),
      },
      fetchedAt: Date.now(),
    });
  }
}
