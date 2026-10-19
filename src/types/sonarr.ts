import type { ArrParsedQuality, InstanceTag, MediaImage, ResolvedLabels } from './arr';
import type { EpisodeFinaleType } from './calendar';
import type { DiscoverLibraryStatus } from './discover';

// Sonarr Types
export interface SonarrSeries {
  id: number;
  title: string;
  sortTitle: string;
  status: string;
  overview: string;
  network: string;
  airTime: string;
  images: MediaImage[];
  seasons: SonarrSeason[];
  year: number;
  path: string;
  qualityProfileId: number;
  seasonFolder: boolean;
  monitored: boolean;
  runtime: number;
  tvdbId: number;
  tmdbId?: number;
  tvRageId: number;
  tvMazeId: number;
  firstAired: string;
  lastAired?: string;
  releaseDate?: string;
  seriesType: string;
  cleanTitle: string;
  imdbId: string;
  titleSlug: string;
  certification: string;
  genres: string[];
  tags: number[];
  added: string;
  ratings: { votes: number; value: number };
  originalLanguage?: { id: number; name: string };
  nextAiring?: string;
  previousAiring?: string;
  statistics: {
    seasonCount: number;
    episodeFileCount: number;
    episodeCount: number;
    totalEpisodeCount: number;
    sizeOnDisk: number;
    releaseGroups?: string[];
    percentOfEpisodes: number;
    latestSeasonHasFiles?: boolean;
  };
}

export type SonarrSeriesListItem = Pick<
  SonarrSeries,
  | 'id'
  | 'title'
  | 'sortTitle'
  | 'status'
  | 'overview'
  | 'network'
  | 'images'
  | 'year'
  | 'path'
  | 'qualityProfileId'
  | 'monitored'
  | 'runtime'
  | 'genres'
  | 'tags'
  | 'added'
  | 'ratings'
  | 'originalLanguage'
  | 'nextAiring'
  | 'previousAiring'
  | 'statistics'
  | 'seriesType'
> & Partial<InstanceTag> & Partial<ResolvedLabels>;

export interface SonarrSeason {
  seasonNumber: number;
  monitored: boolean;
  statistics?: {
    previousAiring?: string;
    episodeFileCount: number;
    episodeCount: number;
    totalEpisodeCount: number;
    sizeOnDisk: number;
    releaseGroups?: string[];
    percentOfEpisodes: number;
  };
}

export interface SonarrEpisode {
  id: number;
  seriesId: number;
  tvdbId: number;
  episodeFileId: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  airDate: string;
  airDateUtc: string;
  overview: string;
  hasFile: boolean;
  monitored: boolean;
  absoluteEpisodeNumber: number;
  unverifiedSceneNumbering: boolean;
  finaleType?: EpisodeFinaleType;
  series?: SonarrSeries;
}

export interface SonarrEpisodeFileLanguage {
  id: number;
  name: string;
}

export interface SonarrEpisodeFileQuality {
  quality: {
    name: string;
    resolution?: number;
  };
}

export interface SonarrEpisodeFileMediaInfo {
  audioBitrate?: number | string;
  audioChannels?: number | string;
  audioCodec?: string;
  audioLanguages?: string;
  audioStreamCount?: number | string;
  videoBitDepth?: number | string;
  videoBitrate?: number | string;
  videoCodec?: string;
  videoDynamicRangeType?: string;
  videoFps?: number | string;
  resolution?: string;
  runTime?: string | number;
  scanType?: string;
  subtitles?: string;
}

export interface SonarrEpisodeFile {
  id: number;
  relativePath: string;
  path: string;
  size: number;
  quality: SonarrEpisodeFileQuality;
  mediaInfo?: SonarrEpisodeFileMediaInfo;
  language?: SonarrEpisodeFileLanguage;
  languages?: SonarrEpisodeFileLanguage[];
}

export interface EpisodeWithFile extends SonarrEpisode {
  episodeFile?: SonarrEpisodeFile;
}

export interface SonarrCalendarEntry extends SonarrEpisode {
  series: SonarrSeries;
}

export interface SonarrRenamePreview {
  seriesId: number;
  seasonNumber: number;
  episodeNumbers: number[];
  episodeFileId: number;
  existingPath: string;
  newPath: string;
}

export interface SonarrParseResult {
  title: string;
  parsedEpisodeInfo?: {
    seriesTitle?: string;
    seasonNumber?: number;
    episodeNumbers?: number[];
    absoluteEpisodeNumbers?: number[];
    fullSeason?: boolean;
    isDaily?: boolean;
    quality?: ArrParsedQuality;
  } | null;
  /** The library series the title maps to, when there is one, and the episodes it covers. */
  series?: { id: number; title: string; tvdbId: number; monitored: boolean } | null;
  episodes?: Array<{ id: number; seasonNumber: number; episodeNumber: number; monitored: boolean; episodeFileId?: number }>;
}

// Lookup results
export interface SonarrLookupResult {
  id?: number | null;
  title: string;
  sortTitle: string;
  status: string;
  overview: string;
  network: string;
  images: MediaImage[];
  seasons: SonarrSeason[];
  year: number;
  tvdbId: number;
  tmdbId?: number;
  imdbId: string;
  path?: string | null;
  added?: string;
  titleSlug: string;
  certification: string;
  genres: string[];
  ratings: { votes: number; value: number };
  runtime: number;
  library?: DiscoverLibraryStatus;
}
