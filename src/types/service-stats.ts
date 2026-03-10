export type DiskSpace = {
  path: string;
  label: string;
  freeSpace: number;
  totalSpace: number;
};

export interface ServicesStatsResponse {
  totalMovies?: number;
  totalSeries?: number;
  activeDownloads?: number;
  diskSpace?: DiskSpace[];
  jellyfin?: {
    movieCount: number;
    seriesCount: number;
    episodeCount: number;
    activeStreams: number;
  };
}
