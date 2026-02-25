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
  tvRageId: number;
  tvMazeId: number;
  firstAired: string;
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
    percentOfEpisodes: number;
    latestSeasonHasFiles?: boolean;
  };
}

export interface SonarrSeason {
  seasonNumber: number;
  monitored: boolean;
  statistics?: {
    episodeFileCount: number;
    episodeCount: number;
    totalEpisodeCount: number;
    sizeOnDisk: number;
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
  series?: SonarrSeries;
}

export interface SonarrCalendarEntry extends SonarrEpisode {
  series: SonarrSeries;
}

// Radarr Types
export interface RadarrMovie {
  id: number;
  title: string;
  sortTitle: string;
  originalTitle?: string;
  originalLanguage?: { id: number; name: string };
  sizeOnDisk: number;
  status: string;
  overview: string;
  inCinemas?: string;
  physicalRelease?: string;
  digitalRelease?: string;
  images: MediaImage[];
  year: number;
  hasFile: boolean;
  path: string;
  qualityProfileId: number;
  monitored: boolean;
  minimumAvailability: string;
  runtime: number;
  tmdbId: number;
  imdbId: string;
  titleSlug: string;
  certification: string;
  genres: string[];
  tags: number[];
  added: string;
  ratings: { 
    imdb?: { votes: number; value: number }; 
    tmdb?: { votes: number; value: number };
    rottenTomatoes?: { votes: number; value: number };
    trakt?: { votes: number; value: number };
  };
  popularity?: number;
  movieFile?: {
    id: number;
    relativePath: string;
    size: number;
    quality: { quality: { name: string } };
  };
  studio: string;
}

export type RadarrCalendarEntry = RadarrMovie;

// Shared Types
export interface MediaImage {
  coverType: string;
  url: string;
  remoteUrl: string;
}

export interface QueueItem {
  id: number;
  downloadId: string;
  title: string;
  status: string;
  trackedDownloadStatus: string;
  trackedDownloadState: string;
  statusMessages: { title: string; messages: string[] }[];
  errorMessage: string;
  timeleft: string;
  estimatedCompletionTime: string;
  size: number;
  sizeleft: number;
  protocol: string;
  downloadClient: string;
  indexer: string;
  outputPath: string;
  downloadForced: boolean;
  // Sonarr-specific
  seriesId?: number;
  episodeId?: number;
  series?: SonarrSeries;
  episode?: SonarrEpisode;
  // Radarr-specific
  movieId?: number;
  movie?: RadarrMovie;
}

export interface QueueResponse {
  page: number;
  pageSize: number;
  sortKey: string;
  sortDirection: string;
  totalRecords: number;
  records: QueueItem[];
}

export interface HistoryItem {
  id: number;
  sourceTitle: string;
  quality: { quality: { name: string } };
  qualityCutoffNotMet: boolean;
  date: string;
  eventType: string;
  data: Record<string, string>;
  // Sonarr-specific
  seriesId?: number;
  episodeId?: number;
  series?: SonarrSeries;
  episode?: SonarrEpisode;
  // Radarr-specific
  movieId?: number;
  movie?: RadarrMovie;
}

export interface HistoryResponse {
  page: number;
  pageSize: number;
  sortKey: string;
  sortDirection: string;
  totalRecords: number;
  records: HistoryItem[];
}

export interface ManualImportItem {
  id: number;
  path: string;
  relativePath: string;
  folderName: string;
  name: string;
  size: number;
  quality: { quality: { id: number; name: string } };
  languages?: { id: number; name: string }[];
  series?: SonarrSeries;
  seasonNumber?: number;
  episodes?: SonarrEpisode[];
  movie?: RadarrMovie;
  rejections: { type: string; reason: string }[];
}

// Release (Interactive Search)
export interface Release {
  guid: string;
  quality: { quality: { id: number; name: string }; revision?: { version: number } };
  qualityWeight: number;
  age: number;
  ageHours: number;
  ageMinutes: number;
  size: number;
  indexerId: number;
  indexer: string;
  releaseGroup: string;
  title: string;
  approved: boolean;
  rejected: boolean;
  rejections: string[];
  seeders: number;
  leechers: number;
  protocol: string;
  downloadUrl: string;
  infoUrl: string;
  indexerFlags: number;
  // Sonarr-specific
  seriesId?: number;
  episodeId?: number;
  seasonNumber?: number;
  fullSeason?: boolean;
  // Radarr-specific
  movieId?: number;
}

export interface DownloadClient {
  id: number;
  name: string;
  enable: boolean;
  protocol: string;
  priority: number;
  implementation: string;
}

export interface DiskSpace {
  path: string;
  label: string;
  freeSpace: number;
  totalSpace: number;
}

export interface HealthCheck {
  source: string;
  type: string;
  message: string;
  wikiUrl: string;
}

export interface QBittorrentTorrent {
  hash: string;
  name: string;
  size: number;
  progress: number;
  dlspeed: number;
  upspeed: number;
  num_seeds: number;
  num_leechs: number;
  state: string;
  eta: number;
  category: string;
  tags: string;
  added_on: number;
  completion_on: number;
  save_path: string;
}

export interface QBittorrentTransferInfo {
  dl_info_speed: number;
  dl_info_data: number;
  up_info_speed: number;
  up_info_data: number;
  dl_rate_limit: number;
  up_rate_limit: number;
  dht_nodes: number;
  connection_status: string;
}

// Calendar Event (unified)
export interface CalendarEvent {
  id: string;
  type: 'episode' | 'movie';
  title: string;
  subtitle: string;
  date: string;
  hasFile: boolean;
  monitored: boolean;
  seriesId?: number;
  movieId?: number;
  images: MediaImage[];
}

// App Types
export interface ServiceConnectionConfig {
  type: 'SONARR' | 'RADARR' | 'QBITTORRENT' | 'PROWLARR' | 'JELLYFIN' | 'TMDB';
  url: string;
  apiKey: string;
}

export interface NotificationEvent {
  eventType: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  url?: string;
}

// Wanted Responses
export interface WantedMissingRecord {
  source: 'sonarr' | 'radarr';
  mediaType: 'episode' | 'movie';
  id: number;
  title?: string;
  // Sonarr episode fields
  seriesId?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  airDateUtc?: string;
  series?: SonarrSeries;
  // Radarr movie fields
  year?: number;
  added?: string;
  monitored?: boolean;
  hasFile?: boolean;
  images?: MediaImage[];
}

export interface WantedResponse {
  page: number;
  pageSize: number;
  totalRecords: number;
  records: WantedMissingRecord[];
}

// Tag type
export interface Tag {
  id: number;
  label: string;
}

// Quality Profiles
export interface QualityProfile {
  id: number;
  name: string;
}

// Root Folders
export interface RootFolder {
  id: number;
  path: string;
  freeSpace: number;
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

export interface RadarrLookupResult {
  id?: number | null;
  title: string;
  sortTitle: string;
  overview: string;
  images: MediaImage[];
  year: number;
  tmdbId: number;
  imdbId: string;
  path?: string | null;
  added?: string;
  titleSlug: string;
  certification: string;
  genres: string[];
  ratings: { imdb?: { votes: number; value: number }; tmdb?: { votes: number; value: number } };
  runtime: number;
  studio: string;
  library?: DiscoverLibraryStatus;
}

export type DiscoverMediaType = 'movie' | 'tv';
export type DiscoverContentType = 'all' | 'movie' | 'show' | 'anime';
export type DiscoverMode = 'sections' | 'browse' | 'search';

export interface DiscoverGenre {
  id: number;
  name: string;
  type: DiscoverMediaType;
}

export interface DiscoverProvider {
  id: number;
  name: string;
  logoPath: string | null;
  displayPriority: number;
  type: DiscoverMediaType;
}

export interface DiscoverNetwork {
  id: number;
  name: string;
  logoPath: string | null;
}

export interface DiscoverLibraryStatus {
  exists: boolean;
  type?: 'movie' | 'series';
  id?: number;
}

export interface DiscoverItem {
  id: number;
  tmdbId: number;
  mediaType: DiscoverMediaType;
  title: string;
  originalTitle?: string;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  releaseDate: string | null;
  year: number | null;
  rating: number;
  voteCount: number;
  popularity: number;
  genres: number[];
  genreNames?: string[];
  originalLanguage?: string;
  originCountry?: string[];
  isAnime?: boolean;
  library?: DiscoverLibraryStatus;
}

export interface DiscoverSection {
  key: string;
  title: string;
  type: 'media' | 'genre' | 'provider' | 'network';
  mediaType?: DiscoverMediaType | 'all';
  items: DiscoverItem[] | DiscoverGenre[] | DiscoverProvider[] | DiscoverNetwork[];
}

export interface DiscoverFilters {
  genres?: number[];
  yearFrom?: number;
  yearTo?: number;
  runtimeMin?: number;
  runtimeMax?: number;
  language?: string;
  region?: string;
  ratingMin?: number;
  ratingMax?: number;
  voteCountMin?: number;
  providers?: number[];
  networks?: number[];
  releaseState?: 'released' | 'upcoming' | 'airing' | 'ended';
}

export interface DiscoverFiltersResponse {
  genres: DiscoverGenre[];
  providers: DiscoverProvider[];
  networks: DiscoverNetwork[];
  regions: Array<{ code: string; name: string }>;
  languages: Array<{ code: string; name: string }>;
  releaseStates: Array<{ value: string; label: string }>;
}

export interface DiscoverResponse {
  mode: DiscoverMode;
  page?: number;
  totalPages?: number;
  totalResults?: number;
  items?: DiscoverItem[];
  sections?: DiscoverSection[];
}

export interface DiscoverDetail extends DiscoverItem {
  runtime: number | null;
  status: string | null;
  imdbId?: string | null;
  tvdbId?: number | null;
  productionCompanies: Array<{ id: number; name: string; logoPath: string | null }>;
  networks: Array<{ id: number; name: string; logoPath: string | null }>;
  addTarget: {
    service: 'radarr' | 'sonarr';
    exists: boolean;
    id?: number;
  };
}
