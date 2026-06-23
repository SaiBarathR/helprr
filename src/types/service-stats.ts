export type DiskSpace = {
  path: string;
  label: string;
  freeSpace: number;
  totalSpace: number;
};

export type DiskTrendDirection = 'up' | 'flat' | 'down';

export type DiskTrend = {
  diskId: string;
  direction: DiskTrendDirection;
  /** Signed growth rate of USED space in bytes/day (positive = filling up). */
  perDayBytes: number;
  /** Estimated days until the disk is full; null when not rising or unknown. */
  daysUntilFull: number | null;
};

export interface StorageTrendResponse {
  trends: Record<string, DiskTrend>;
}

export interface ServicesStatsResponse {
  totalMovies?: number;
  totalSeries?: number;
  totalArtists?: number;
  activeDownloads?: number;
  diskSpace?: DiskSpace[];
  jellyfin?: {
    movieCount: number;
    seriesCount: number;
    episodeCount: number;
    activeStreams: number;
  };
}
