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
