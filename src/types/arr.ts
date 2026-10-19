import type { LidarrAlbum, LidarrArtist } from './lidarr';
import type { RadarrMovie } from './radarr';
import type { SonarrEpisode, SonarrEpisodeFileMediaInfo, SonarrSeries } from './sonarr';

export interface InstanceTag {
  instanceId: string;
  instanceLabel: string;
}

/**
 * Display labels resolved server-side against the item's OWN instance. List routes
 * aggregate items from every connected instance, but quality-profile / tag /
 * metadata-profile IDs are instance-local — so the server resolves them per instance
 * and the client renders these names directly instead of mapping IDs through a single
 * (default-instance) lookup, which mislabels non-default rows.
 */
export interface ResolvedLabels {
  qualityProfileName?: string;
  metadataProfileName?: string;
  tagLabels?: string[];
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
  episodeFileId?: number; // set when this scanned file is already imported (Sonarr)
  movie?: RadarrMovie;
  movieFileId?: number; // set when already imported (Radarr)
  releaseGroup?: string;
  customFormatScore?: number;
  indexerFlags?: number;
  releaseType?: ReleaseType;
  rejections: { type: string; reason: string }[];
}

// ── Manage Episodes / Manage Files: file resources ──────────────────────────
// These model the *arr `episodefile` / `moviefile` REST resources. The same
// shape is returned by GET (?seriesId=/?movieId=) and accepted by the bulk-edit
// PUT (.../bulk) — the server keys each by `id` and applies only the non-null
// editable fields.

export interface ArrLanguage {
  id: number;
  name: string;
}

export interface ArrQualityModel {
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

// GET /api/v3/qualitydefinition — the catalog of qualities the bulk-edit quality
// picker offers. `quality` is the QualityModel.quality to assign to a file.
export interface QualityDefinition {
  id: number;
  title: string;
  weight?: number;
  quality: ArrQualityModel['quality'];
}

// Sonarr-only. Stored on EpisodeFile; editable per-file and via the bulk menu.
export type ReleaseType = 'unknown' | 'singleEpisode' | 'multiEpisode' | 'seasonPack';

export interface EpisodeFileResource {
  id: number;
  seriesId: number;
  seasonNumber: number;
  relativePath?: string;
  path?: string;
  size?: number;
  dateAdded?: string;
  sceneName?: string;
  releaseGroup?: string;
  languages?: ArrLanguage[];
  quality?: ArrQualityModel;
  customFormats?: { id: number; name: string }[];
  customFormatScore?: number;
  indexerFlags?: number;
  releaseType?: ReleaseType;
  mediaInfo?: SonarrEpisodeFileMediaInfo;
  qualityCutoffNotMet?: boolean;
}

export interface MovieFileResource {
  id: number;
  movieId: number;
  relativePath?: string;
  path?: string;
  size?: number;
  dateAdded?: string;
  sceneName?: string;
  releaseGroup?: string;
  edition?: string; // Radarr-only
  languages?: ArrLanguage[];
  quality?: ArrQualityModel;
  customFormats?: { id: number; name: string }[];
  customFormatScore?: number;
  indexerFlags?: number;
  mediaInfo?: SonarrEpisodeFileMediaInfo; // same field set as Radarr's
  qualityCutoffNotMet?: boolean;
}

// The subset of fields the Manage UI may bulk-edit. The route builds the *arr
// resource from these (never forwards the raw client object) so path/relativePath
// and other server-owned fields can't be tampered with.
export interface EpisodeFileEdit {
  id: number;
  quality?: ArrQualityModel;
  languages?: ArrLanguage[];
  releaseGroup?: string;
  indexerFlags?: number;
  releaseType?: ReleaseType;
}

export interface MovieFileEdit {
  id: number;
  quality?: ArrQualityModel;
  languages?: ArrLanguage[];
  releaseGroup?: string;
  indexerFlags?: number;
  edition?: string;
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
  // Present on the /api/v3/release payload; power the interactive-search
  // CF-score sort/badge and the language facet.
  customFormatScore?: number;
  customFormats?: { id: number; name: string }[];
  languages?: { id: number; name: string }[];
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
  /** A tagged client is used only for titles sharing one of its tags. */
  tags?: number[];
  /** Implementation settings, e.g. qBittorrent's movieCategory / tvCategory. */
  fields?: Array<{ name: string; value?: unknown }>;
}

/** Arr's mapping of a download client's paths to its own (Settings → Download Clients). */
export interface ArrRemotePathMapping {
  id: number;
  host: string;
  remotePath: string;
  localPath: string;
}

/** A folder as Arr sees it (GET /api/v3/filesystem). A missing folder lists as empty, not as an error. */
export interface ArrFolderListing {
  parent?: string;
  directories: Array<{ name: string; path: string }>;
  files: Array<{ name: string; path: string; size: number }>;
}

/** Arr's own reading of a release title (GET /api/v3/parse). */
export interface ArrParsedQuality {
  quality: { id: number; name: string };
}

/** A hand-supplied release for POST /api/v3/release/push. Arr maps it by parsing `title`. */
export interface ArrReleasePushInput {
  title: string;
  protocol: 'torrent';
  publishDate: string;
  magnetUrl?: string;
  downloadUrl?: string;
  downloadClientId?: number;
  tmdbId?: number;
  tvdbId?: number;
}

/** Arr's decision on a pushed release. `approved` alone does not mean it was grabbed. */
export interface ArrReleasePushResult {
  title: string;
  approved: boolean;
  rejected: boolean;
  temporarilyRejected?: boolean;
  rejections?: string[];
  infoHash?: string;
  mappedMovieId?: number;
  mappedSeriesId?: number;
  mappedEpisodeInfo?: Array<{ id: number; seasonNumber: number; episodeNumber: number }>;
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

// Media-management config (GET /api/v3/config/mediamanagement). Drives the
// destructive-confirmation drawer: whether a delete goes to a recycle bin or is
// permanent, and whether a delete unmonitors. Only the fields we act on are
// modeled; the *arr response has many more. The auto-unmonitor field name
// differs per app, so both optional variants are included.
export interface MediaManagementConfig {
  id?: number;
  /** Recycle Bin path. Empty/blank string = deletes are PERMANENT. */
  recycleBin: string;
  recycleBinCleanupDays?: number;
  /** Sonarr: unmonitor episode on manual file delete. */
  autoUnmonitorPreviouslyDownloadedEpisodes?: boolean;
  /** Radarr: (Radarr does NOT unmonitor on file delete — present for parity only). */
  autoUnmonitorPreviouslyDownloadedMovies?: boolean;
  /** Import copies as hardlinks when possible instead of byte-copy. */
  copyUsingHardlinks?: boolean;
  /** Import files with these extensions found next to an imported video (subtitles, nfo...). */
  importExtraFiles?: boolean;
  /** Comma-separated, e.g. "srt, .sub". */
  extraFileExtensions?: string;
}
