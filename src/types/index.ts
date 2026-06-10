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

export interface InstanceTag {
  instanceId: string;
  instanceLabel: string;
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
> & Partial<InstanceTag>;

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
    metacritic?: { votes: number; value: number };
    rottenTomatoes?: { votes: number; value: number };
    trakt?: { votes: number; value: number };
  };
  popularity?: number;
  movieFile?: {
    id: number;
    relativePath: string;
    path?: string;
    sceneName?: string;
    releaseGroup?: string;
    edition?: string;
    indexerFlags?: number;
    originalFilePath?: string;
    qualityCutoffNotMet?: boolean;
    size: number;
    quality: {
      quality: {
        name: string;
        id?: number;
        source?: string;
        resolution?: number;
        modifier?: string;
      };
      revision?: {
        version?: number;
        real?: number;
        isRepack?: boolean;
      };
    };
    dateAdded?: string;
    customFormatScore?: number;
    language?: { id: number; name: string };
    languages?: { id: number; name: string }[];
    mediaInfo?: {
      runTime?: string | number;
      resolution?: string;
      videoCodec?: string;
      videoDynamicRange?: string;
      videoDynamicRangeType?: string;
      videoBitrate?: number | string;
      videoFps?: number | string;
      videoBitDepth?: number | string;
      scanType?: string;
      audioCodec?: string;
      audioChannels?: number | string;
      audioBitrate?: number | string;
      audioStreamCount?: number | string;
      audioLanguages?: string;
      subtitles?: string;
    };
  };
  studio: string;
}

export type RadarrMovieListItem = Pick<
  RadarrMovie,
  | 'id'
  | 'title'
  | 'sortTitle'
  | 'originalTitle'
  | 'originalLanguage'
  | 'sizeOnDisk'
  | 'status'
  | 'overview'
  | 'inCinemas'
  | 'physicalRelease'
  | 'digitalRelease'
  | 'images'
  | 'year'
  | 'hasFile'
  | 'path'
  | 'qualityProfileId'
  | 'monitored'
  | 'runtime'
  | 'genres'
  | 'tags'
  | 'added'
  | 'ratings'
  | 'popularity'
  | 'studio'
  | 'certification'
> & Partial<InstanceTag>;

export type RadarrCalendarEntry = RadarrMovie;

export interface RadarrRenamePreview {
  movieId: number;
  movieFileId: number;
  existingPath: string;
  newPath: string;
}

// Lidarr Types
export interface LidarrArtistStatistics {
  albumCount: number;
  trackFileCount: number;
  trackCount: number;
  totalTrackCount: number;
  sizeOnDisk: number;
  percentOfTracks: number;
}

export interface LidarrAlbumStatistics {
  trackFileCount: number;
  trackCount: number;
  totalTrackCount: number;
  sizeOnDisk: number;
  percentOfTracks: number;
}

export interface LidarrMedium {
  mediumNumber: number;
  mediumName: string;
  mediumFormat: string;
}

export interface LidarrLink {
  url: string;
  name: string;
}

export interface LidarrArtist {
  id: number;
  artistName: string;
  foreignArtistId: string; // MusicBrainz artist ID
  mbId?: string;
  tadbId?: number;
  discogsId?: number;
  overview: string;
  artistType: string; // Person, Group, ...
  disambiguation: string;
  status: string; // continuing, ended
  ended: boolean;
  sortName: string;
  cleanName?: string;
  monitored: boolean;
  monitorNewItems?: string; // all, none
  images: MediaImage[];
  links: LidarrLink[];
  genres: string[];
  ratings: { votes: number; value: number };
  qualityProfileId: number;
  metadataProfileId: number;
  rootFolderPath?: string;
  path?: string;
  tags: number[];
  added: string;
  statistics?: LidarrArtistStatistics;
  lastAlbum?: LidarrAlbum;
  nextAlbum?: LidarrAlbum;
}

export type LidarrArtistListItem = Pick<
  LidarrArtist,
  | 'id'
  | 'artistName'
  | 'foreignArtistId'
  | 'sortName'
  | 'status'
  | 'ended'
  | 'artistType'
  | 'disambiguation'
  | 'overview'
  | 'images'
  | 'genres'
  | 'monitored'
  | 'qualityProfileId'
  | 'metadataProfileId'
  | 'ratings'
  | 'added'
  | 'statistics'
  | 'path'
  | 'tags'
  | 'nextAlbum'
  | 'lastAlbum'
> & Partial<InstanceTag>;

export interface LidarrRelease {
  id: number;
  albumId: number;
  foreignReleaseId: string;
  title: string;
  status: string;
  duration: number;
  trackCount: number;
  media: LidarrMedium[];
  mediumCount: number;
  disambiguation: string;
  country: string[];
  label: string[];
  format: string;
  monitored: boolean;
}

export interface LidarrAlbum {
  id: number;
  title: string;
  disambiguation: string;
  overview: string;
  artistId: number;
  foreignAlbumId: string; // MusicBrainz release-group ID
  monitored: boolean;
  anyReleaseOk: boolean;
  profileId: number;
  duration: number;
  albumType: string; // Album, EP, Single, Broadcast, Other
  secondaryTypes: string[];
  mediumCount: number;
  ratings: { votes: number; value: number };
  releaseDate: string;
  releases: LidarrRelease[];
  images: MediaImage[];
  links: LidarrLink[];
  genres: string[];
  media?: LidarrMedium[];
  artist?: LidarrArtist;
  statistics?: LidarrAlbumStatistics;
  remoteCover?: string; // present on lookup results
}

export interface LidarrTrack {
  id: number;
  artistId: number;
  albumId: number;
  foreignTrackId: string;
  foreignRecordingId: string;
  trackFileId: number;
  explicit: boolean;
  absoluteTrackNumber: number;
  trackNumber: string;
  title: string;
  duration: number; // milliseconds
  mediumNumber: number;
  hasFile: boolean;
  ratings: { votes: number; value: number };
}

export interface LidarrMediaInfo {
  audioChannels?: number;
  audioBitRate?: string;
  audioCodec?: string;
  audioBits?: string;
  audioSampleRate?: string;
}

export interface LidarrTrackFile {
  id: number;
  artistId: number;
  albumId: number;
  path: string;
  size: number;
  dateAdded: string;
  quality: {
    quality: { id: number; name: string };
    revision?: { version: number; real: number; isRepack: boolean };
  };
  mediaInfo?: LidarrMediaInfo;
  qualityCutoffNotMet?: boolean;
  qualityWeight?: number;
  customFormats?: QueueCustomFormat[];
  customFormatScore?: number;
}

export type LidarrCalendarEntry = LidarrAlbum & { artist: LidarrArtist };

export interface LidarrArtistLookupResult {
  id?: number | null;
  artistName: string;
  foreignArtistId: string;
  artistType: string;
  disambiguation: string;
  status: string;
  ended: boolean;
  overview: string;
  images: MediaImage[];
  links: LidarrLink[];
  genres: string[];
  ratings: { votes: number; value: number };
  remotePoster?: string;
  library?: DiscoverLibraryStatus;
}

export interface LidarrAlbumLookupResult {
  id?: number | null;
  title: string;
  foreignAlbumId: string;
  artistId?: number;
  artist?: LidarrArtist;
  albumType: string;
  secondaryTypes: string[];
  releaseDate: string;
  disambiguation: string;
  overview: string;
  images: MediaImage[];
  links: LidarrLink[];
  genres: string[];
  ratings: { votes: number; value: number };
  remoteCover?: string;
}

export interface LidarrMetadataProfile {
  id: number;
  name: string;
}

export interface LidarrRenamePreview {
  artistId: number;
  albumId: number;
  trackNumbers: number[];
  trackFileId: number;
  existingPath: string;
  newPath: string;
}

// Shared Types
export interface MediaImage {
  coverType: string;
  url: string;
  remoteUrl: string;
}

export interface QueueLanguage {
  id: number;
  name: string;
}

export interface QueueQuality {
  quality: {
    id: number;
    name: string;
    source?: string;
    resolution?: number;
    modifier?: string;
  };
  revision?: {
    version?: number;
    real?: number;
    isRepack?: boolean;
  };
}

export interface QueueCustomFormat {
  id: number;
  name: string;
}

export interface QueueItem {
  id: number;
  instanceId?: string;
  instanceLabel?: string;
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
  added?: string;
  protocol: string;
  downloadClient: string;
  downloadClientHasPostImportCategory?: boolean;
  indexer: string;
  outputPath: string;
  downloadForced: boolean;
  quality?: QueueQuality;
  customFormats?: QueueCustomFormat[];
  customFormatScore?: number;
  languages?: QueueLanguage[];
  source?: 'sonarr' | 'radarr' | 'lidarr';
  // Sonarr-specific
  seriesId?: number;
  episodeId?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  series?: SonarrSeries;
  episode?: SonarrEpisode;
  // Radarr-specific
  movieId?: number;
  movie?: RadarrMovie;
  // Lidarr-specific
  artistId?: number;
  albumId?: number;
  trackId?: number;
  artist?: LidarrArtist;
  album?: LidarrAlbum;
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
  instanceId?: string;
  instanceLabel?: string;
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
  // Lidarr-specific
  artistId?: number;
  albumId?: number;
  trackId?: number;
  artist?: LidarrArtist;
  album?: LidarrAlbum;
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
  // Lidarr-specific
  artistId?: number;
  albumId?: number;
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
  priority: number;
  added_on: number;
  completion_on: number;
  save_path: string;
  amount_left: number;
  completed: number;
  downloaded: number;
  uploaded: number;
  downloaded_session: number;
  uploaded_session: number;
  dl_limit: number;
  up_limit: number;
  magnet_uri: string;
  time_active: number;
  seeding_time: number;
  availability: number;
  ratio: number;
  seq_dl: boolean;
  f_l_piece_prio: boolean;
  force_start: boolean;
  auto_tmm: boolean;
  max_ratio: number;
  max_seeding_time: number;
  private?: boolean;
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

export interface QBittorrentSummaryResponse {
  torrents: QBittorrentTorrent[];
  transferInfo: QBittorrentTransferInfo | null;
  speedLimitsMode?: number;
}

// Calendar Event (unified)
export type MovieReleaseType = 'cinema' | 'physical' | 'digital';
export type EpisodeFinaleType = 'series' | 'season' | 'midseason';

export interface CalendarEvent {
  id: string;
  instanceId?: string;
  instanceLabel?: string;
  type: 'episode' | 'movie' | 'album';
  title: string;
  subtitle: string;
  date: string;
  hasFile: boolean;
  monitored: boolean;
  seriesId?: number;
  movieId?: number;
  artistId?: number;
  albumId?: number;
  images: MediaImage[];
  releaseType?: MovieReleaseType;
  finaleType?: EpisodeFinaleType;
}

// App Types
export interface ServiceConnectionConfig {
  type: 'SONARR' | 'RADARR' | 'QBITTORRENT' | 'PROWLARR' | 'JELLYFIN' | 'TMDB' | 'SEERR' | 'LIDARR';
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
  source: 'sonarr' | 'radarr' | 'lidarr';
  mediaType: 'episode' | 'movie' | 'album';
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
  // Lidarr album fields
  artistId?: number;
  albumId?: number;
  releaseDate?: string;
  artist?: LidarrArtist;
}

export interface WantedResponse {
  page: number;
  pageSize: number;
  totalRecords: number;
  records: WantedMissingRecord[];
}

// Radarr collections (GET /api/v3/collection) — only the fields the gaps page uses
export interface RadarrCollectionMovie {
  tmdbId: number;
  title: string;
  year?: number;
  images?: MediaImage[];
  monitored?: boolean;
}

export interface RadarrCollection {
  id: number;
  title: string;
  tmdbId?: number;
  monitored: boolean;
  images?: MediaImage[];
  movies: RadarrCollectionMovie[];
}

// Library Gaps page
export type LibraryGapSearchTarget =
  | { kind: 'episode'; episodeId: number }
  | { kind: 'season'; sonarrSeriesId: number; seasonNumber: number }
  | { kind: 'movie'; radarrMovieId: number }
  | { kind: 'none' };

export interface LibraryGapItem {
  key: string;
  title: string;
  subtitle?: string;
  date?: string; // ISO; rendered as relative time client-side
  year?: number;
  poster: string | null;
  href?: string;
  search: LibraryGapSearchTarget;
  collectionTitle?: string;
  tmdbId?: number;
}

export type LibraryGapSectionId = 'missingSeasons' | 'newUpcoming' | 'collectionGaps' | 'overdue';

export interface LibraryGapSection {
  id: LibraryGapSectionId;
  count: number; // true total found (may exceed items.length when truncated)
  items: LibraryGapItem[];
  available: boolean; // false when the backing service is unconfigured or its fetch failed
  error?: boolean; // true when the service is configured but the fetch failed (vs. simply not connected)
}

export interface LibraryGapsResponse {
  sections: LibraryGapSection[];
}

// Radarr Credit
export interface RadarrCredit {
  id: number;
  personName: string;
  personTmdbId: number;
  character?: string;
  department?: string;
  job?: string;
  type: 'cast' | 'crew';
  order: number;
  images: MediaImage[];
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
export type DiscoverContentType = 'all' | 'movie' | 'show';
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
  titleSlug?: string;
  tmdbId?: number;
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
  companies?: number[];
  releaseState?: 'released' | 'upcoming' | 'airing' | 'ended';
  withPeople?: number[];
  withCast?: number[];
  withCrew?: number[];
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

export interface DiscoverCastMember {
  id: number;
  name: string;
  character: string;
  profilePath: string | null;
  order: number;
}

export interface DiscoverCrewMember {
  id: number;
  name: string;
  department: string;
  job: string;
  profilePath: string | null;
}

export interface DiscoverAggregateCastMember {
  id: number;
  name: string;
  profilePath: string | null;
  character: string;
  episodeCount: number;
  order: number;
}

export interface DiscoverVideo {
  id: string;
  key: string;
  name: string;
  site: string;
  type: string;
  official: boolean;
}

export interface DiscoverWatchProviderEntry {
  logoPath: string;
  providerId: number;
  providerName: string;
}

export interface DiscoverWatchProviders {
  /** Region the returned entries belong to (ISO 3166-1 alpha-2). */
  region: string;
  /** Region the caller asked for; may differ from `region` when a fallback was used. */
  requestedRegion: string;
  link?: string;
  flatrate?: DiscoverWatchProviderEntry[];
  rent?: DiscoverWatchProviderEntry[];
  buy?: DiscoverWatchProviderEntry[];
}

export interface DiscoverSeasonBrief {
  id: number;
  airDate: string | null;
  episodeCount: number;
  name: string;
  overview: string;
  posterPath: string | null;
  seasonNumber: number;
  voteAverage: number;
}

export interface DiscoverMovieFullDetail extends DiscoverDetail {
  tagline: string | null;
  budget: number | null;
  revenue: number | null;
  homepage: string | null;
  certification: string | null;
  collection: {
    id: number;
    name: string;
    posterPath: string | null;
    backdropPath: string | null;
  } | null;
  cast: DiscoverCastMember[];
  crew: DiscoverCrewMember[];
  videos: DiscoverVideo[];
  similar: DiscoverItem[];
  recommendations: DiscoverItem[];
  watchProviders: DiscoverWatchProviders | null;
}

export interface DiscoverTvFullDetail extends DiscoverDetail {
  tagline: string | null;
  homepage: string | null;
  certification: string | null;
  createdBy: Array<{ id: number; name: string; profilePath: string | null }>;
  numberOfSeasons: number;
  numberOfEpisodes: number;
  lastAirDate: string | null;
  nextEpisode: {
    name: string;
    airDate: string | null;
    episodeNumber: number;
    seasonNumber: number;
  } | null;
  showType: string | null;
  seasons: DiscoverSeasonBrief[];
  cast: DiscoverAggregateCastMember[];
  crew: DiscoverCrewMember[];
  videos: DiscoverVideo[];
  similar: DiscoverItem[];
  recommendations: DiscoverItem[];
  watchProviders: DiscoverWatchProviders | null;
}

export interface DiscoverSeasonEpisode {
  id: number;
  name: string;
  overview: string;
  airDate: string | null;
  episodeNumber: number;
  seasonNumber: number;
  stillPath: string | null;
  voteAverage: number;
  runtime: number | null;
}

export interface DiscoverSeasonDetailResponse {
  id: number;
  name: string;
  overview: string;
  airDate: string | null;
  posterPath: string | null;
  seasonNumber: number;
  episodes: DiscoverSeasonEpisode[];
}

export interface DiscoverCollectionDetail {
  id: number;
  name: string;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  parts: DiscoverItem[];
}
