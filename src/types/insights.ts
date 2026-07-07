export interface InsightsLibraryResponse {
  from: string;
  to: string;
  days: string[];
  series: {
    movies: number[] | null;
    series: number[] | null;
    music: number[] | null;
    total: number[];
  };
  totals: {
    movies: number | null;
    series: number | null;
    music: number | null;
    total: number | null;
  };
}

export interface InsightsDownloadDay {
  date: string;
  grabbed: number;
  imported: number;
  failed: number;
}

export interface InsightsDownloadsResponse {
  from: string;
  to: string;
  perDay: InsightsDownloadDay[];
  totals: { grabbed: number; imported: number; failed: number };
  successRate: number | null;
}

// ─── Pipeline intelligence: derived from *arr history over the range ───

export interface InsightsPipelineIndexer {
  name: string;
  grabs: number;
  failures: number;
}

export interface InsightsPipelineResponse {
  from: string;
  to: string;
  /** Grab+import activity per local hour of day (24 buckets). */
  hours: number[];
  /** Grab→import wait, matched per downloadId. Null when no pair completed in range. */
  latency: { medianMins: number; p90Mins: number; samples: number } | null;
  indexers: InsightsPipelineIndexer[];
  releaseGroups: { name: string; imports: number }[];
}

// ─── Storage: where the disk actually goes ───

export interface InsightsStorageItem {
  title: string;
  year?: number;
  sizeOnDisk: number;
  kind: 'movie' | 'series' | 'artist';
  href: string | null;
}

export interface InsightsStorageResponse {
  /** Bytes per service; null when the service is unavailable or not permitted. */
  totals: { movies: number | null; series: number | null; music: number | null };
  counts: { movies: number | null; series: number | null; music: number | null };
  topItems: InsightsStorageItem[];
  /** Bytes held by unmonitored items — reclaimable without losing anything tracked. */
  unmonitoredBytes: number;
}

// ─── Media analysis: technical file breakdown from *arr mediaInfo ───

export type MediaAnalysisKind = 'movie' | 'episode';

/** One media file, normalized from Sonarr/Radarr mediaInfo. */
export interface MediaAnalysisFile {
  /** `${kind}:${instanceId}:${fileId}` — stable across requests. */
  id: string;
  kind: MediaAnalysisKind;
  /** Movie title / series title. */
  title: string;
  /** Year for movies, file name for episodes. */
  subtitle: string | null;
  instanceLabel: string;
  size: number;
  videoCodec: string | null;
  /** Bucketed: '2160p' | '1080p' | '720p' | 'SD'. */
  resolution: string | null;
  /** Bits per second. */
  videoBitrate: number | null;
  /** True when videoBitrate was derived from size/runtime (container had no BPS tag). */
  bitrateEstimated: boolean;
  videoBitDepth: number | null;
  /** 'SDR', 'HDR10', 'Dolby Vision', … — null when mediaInfo is missing. */
  dynamicRange: string | null;
  videoFps: number | null;
  audioCodec: string | null;
  audioChannels: number | null;
  audioLanguages: string[];
  subtitleCount: number | null;
  runtimeMins: number | null;
  /** 0–100 technical quality score; null when too little metadata to judge. */
  score: number | null;
  href: string | null;
}

export interface MediaAnalysisDistEntry {
  name: string;
  count: number;
  bytes: number;
}

export interface MediaAnalysisUpgradeCandidate {
  id: string;
  kind: MediaAnalysisKind;
  title: string;
  subtitle: string | null;
  resolution: string | null;
  videoCodec: string | null;
  size: number;
  score: number;
  reasons: string[];
  href: string | null;
}

export interface MediaAnalysisResponse {
  /** Per-service availability; false = unpermitted, unconfigured, or fetch failed. */
  available: { movies: boolean; series: boolean };
  /** True when the Sonarr episode-file sweep was cut short (some series failed). */
  partial: boolean;
  totals: {
    files: number;
    bytes: number;
    movies: number;
    episodes: number;
    /** Mean video bitrate (bps) across files that report one. */
    avgVideoBitrate: number | null;
    scoredFiles: number;
  };
  distributions: {
    videoCodec: MediaAnalysisDistEntry[];
    resolution: MediaAnalysisDistEntry[];
    dynamicRange: MediaAnalysisDistEntry[];
    audioCodec: MediaAnalysisDistEntry[];
    audioChannels: MediaAnalysisDistEntry[];
    videoBitDepth: MediaAnalysisDistEntry[];
  };
  quality: {
    avgScore: number | null;
    /** Five fixed buckets: 0–19, 20–39, 40–59, 60–79, 80–100. */
    histogram: { bucket: string; count: number }[];
    upgradeCandidates: MediaAnalysisUpgradeCandidate[];
  };
}

export interface MediaAnalysisFilesResponse {
  rows: MediaAnalysisFile[];
  total: number;
  page: number;
  pageSize: number;
  /** Distinct values across the (kind-filtered) dataset, for the filter selects. */
  options: {
    videoCodec: string[];
    resolution: string[];
    dynamicRange: string[];
    audioCodec: string[];
  };
}

// ─── Seeding economics: aggregate qBittorrent view ───

export interface InsightsTorrentsResponse {
  count: number;
  seeding: number;
  totalUploaded: number;
  totalDownloaded: number;
  overallRatio: number | null;
  /** Completed torrents still below ratio 1.0. */
  belowRatio1: number;
  topUploaded: { name: string; uploaded: number; ratio: number }[];
}
