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

const seriesDetailCache = new Map<number, SeriesDetailSnapshot>();
const seasonDetailCache = new Map<string, SeasonDetailSnapshot>();
const episodeDetailCache = new Map<string, EpisodeDetailSnapshot>();

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
  seriesDetailCache.set(seriesId, withFetchedAt(snapshot));
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
  seasonDetailCache.set(seasonKey(seriesId, seasonNumber), withFetchedAt(snapshot));
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
  episodeDetailCache.set(episodeKey(seriesId, episodeId), withFetchedAt(snapshot));
}

export function patchEpisodeAcrossSnapshots(
  seriesId: number,
  episodeId: number,
  updater: (episode: SonarrEpisode) => SonarrEpisode
) {
  const seriesSnapshot = seriesDetailCache.get(seriesId);
  if (seriesSnapshot) {
    let changed = false;
    const nextEpisodes = seriesSnapshot.episodes.map((episode) => {
      if (episode.id !== episodeId) return episode;
      changed = true;
      return updater(episode);
    });
    if (changed) {
      seriesDetailCache.set(seriesId, {
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
      if (episode.id !== episodeId) return episode;
      changed = true;
      return updater(episode);
    });
    if (changed) {
      seasonDetailCache.set(key, {
        ...snapshot,
        episodes: nextEpisodes,
        fetchedAt: Date.now(),
      });
    }
  }

  const snapshotKey = episodeKey(seriesId, episodeId);
  const episodeSnapshot = episodeDetailCache.get(snapshotKey);
  if (episodeSnapshot?.episode) {
    episodeDetailCache.set(snapshotKey, {
      ...episodeSnapshot,
      episode: updater(episodeSnapshot.episode),
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
    seriesDetailCache.set(seriesId, {
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
    seasonDetailCache.set(seasonSnapshotKey, {
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
    episodeDetailCache.set(key, {
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
