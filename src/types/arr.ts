import type { LidarrAlbum, LidarrArtist, LidarrTrack } from './lidarr';
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
  /** The download client's id for the release (shared with its queue item). */
  downloadId?: string;
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

/** A release the *arr refuses to grab again (Sonarr/Radarr /api/v3/blocklist, Lidarr /api/v1/blocklist). */
export interface BlocklistItem {
  id: number;
  sourceTitle: string;
  date: string;
  protocol?: string;
  indexer?: string;
  message?: string;
  quality?: { quality: { name: string } };
  // Sonarr-specific
  seriesId?: number;
  series?: { id: number; title: string };
  // Radarr-specific
  movieId?: number;
  movie?: { id: number; title: string; year?: number };
  // Lidarr-specific
  artistId?: number;
  artist?: { id: number; artistName: string };
}

export interface BlocklistResponse {
  page: number;
  pageSize: number;
  totalRecords: number;
  records: BlocklistItem[];
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
  // Lidarr: the album, release and tracks the file was matched to.
  artist?: LidarrArtist;
  album?: LidarrAlbum;
  albumReleaseId?: number;
  tracks?: LidarrTrack[];
  disableReleaseSwitching?: boolean;
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
  quality: ArrQualityModel;
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
  // No downloadUrl / magnetUrl: the Arr clients drop them (Prowlarr's link
  // carries its API key; see arr-release-links). Grabs go by indexerId + guid.
  infoUrl: string;
  indexerFlags: number;
  // Present on the /api/v3/release payload; power the interactive-search
  // CF-score sort/badge and the language facet.
  customFormatScore?: number;
  customFormats?: { id: number; name: string }[];
  languages?: { id: number; name: string }[];
  /**
   * False when Sonarr/Radarr couldn't tell which series and episodes (or movie)
   * the release is for: a plain grab then fails, so the user confirms the
   * search's own item or chooses one (Manual grab). Missing counts as true.
   */
  downloadAllowed?: boolean;
  // Sonarr-specific
  seriesId?: number;
  episodeId?: number;
  seasonNumber?: number;
  fullSeason?: boolean;
  /** Read from the release title, whether or not Sonarr matched it. */
  seriesTitle?: string;
  episodeNumbers?: number[];
  /** What Sonarr matched the release to; absent or empty when it couldn't. */
  mappedSeriesId?: number;
  mappedSeasonNumber?: number;
  mappedEpisodeInfo?: ReleaseEpisode[];
  // Radarr-specific
  movieId?: number;
  /** Titles read from the release, whether or not Radarr matched it. */
  movieTitles?: string[];
  mappedMovieId?: number;
  // Lidarr-specific
  artistId?: number;
  albumId?: number;
}

/** An episode a Sonarr release maps to (ReleaseEpisodeResource). */
export interface ReleaseEpisode {
  id: number;
  seasonNumber: number;
  episodeNumber: number;
  absoluteEpisodeNumber?: number;
  title?: string;
}

/**
 * POST /api/v3/release bodies Helprr sends. Sonarr and Radarr find the release
 * in their search cache by indexerId + guid, then:
 * - plain: grab it as they matched it;
 * - context: when they couldn't match it, use the item that was searched for;
 * - override: grab it as the user chose (Manual grab); every field is required.
 */
interface ArrGrabBase {
  guid: string;
  indexerId: number;
  downloadClientId?: number;
}
export type SonarrGrabRequest = ArrGrabBase & (
  | { episodeId?: never; seriesId?: never; shouldOverride?: never }
  | { episodeId: number }
  | { seriesId: number; seasonNumber: number }
  | { shouldOverride: true; seriesId: number; episodeIds: number[]; quality: ArrQualityModel; languages: ArrLanguage[] }
);
export type RadarrGrabRequest = ArrGrabBase & (
  | { movieId?: never; shouldOverride?: never }
  | { movieId: number }
  | { shouldOverride: true; movieId: number; quality: ArrQualityModel; languages: ArrLanguage[] }
);

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

/** One release from an arr's GET /update (Sonarr/Radarr v3, Lidarr/Prowlarr v1), newest first. */
export interface ArrUpdate {
  version: string;
  releaseDate?: string;
  installed: boolean;
  installable: boolean;
  latest: boolean;
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

// One quality profile as Sonarr/Radarr (v3) and Lidarr (v1) return it. `items`
// run least preferred first; an entry with its own `items` is a group, whose id
// shares the cutoff's id space (groups start at 1000).
export interface QualityProfileItemResource {
  id?: number;
  name?: string;
  quality?: { id: number; name: string };
  items?: QualityProfileItemResource[];
  allowed: boolean;
}

export interface QualityProfileResource {
  id: number;
  name: string;
  upgradeAllowed?: boolean;
  cutoff: number;
  items: QualityProfileItemResource[];
  minFormatScore?: number;
  cutoffFormatScore?: number;
  minUpgradeFormatScore?: number;
  formatItems?: Array<{ format: number; name?: string; score: number }>;
  /** Radarr only; Sonarr v4 and Lidarr choose languages with custom formats. */
  language?: { id: number; name: string };
}

/** What the quality profile sheet shows: rebuilt from an allow-list, never the raw resource. */
export interface QualityProfileSummary {
  id: number;
  name: string;
  upgradeAllowed: boolean;
  /** The cutoff quality or group's name; null when it names nothing in the profile. */
  cutoff: string | null;
  /** Allowed qualities, most preferred first. A group lists its allowed members. */
  qualities: Array<{ name: string; isCutoff: boolean; members: string[] }>;
  minFormatScore: number | null;
  cutoffFormatScore: number | null;
  minUpgradeFormatScore: number | null;
  language: string | null;
  /** Every custom format's score in this profile: non-zero ones first, highest first. */
  formats: Array<{ name: string; score: number }>;
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
