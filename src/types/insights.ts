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
