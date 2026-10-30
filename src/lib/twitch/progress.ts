export interface DownloadProgress {
  status: string;
  downloadedBytes: number | null;
  totalBytes: number | null;
  etaSeconds: number | null;
  speed: number | null;
}

export const YT_DLP_PROGRESS_TEMPLATE =
  'download:{"s":%(progress.status)j,"d":%(progress.downloaded_bytes)j,"t":%(progress.total_bytes)j,"e":%(progress.eta)j,"v":%(progress.speed)j}';

const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** One line of yt-dlp output: progress JSON, or null for anything else it prints. */
export function parseProgressLine(line: string): DownloadProgress | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{"s":')) return null;
  try {
    const value = JSON.parse(trimmed) as Record<string, unknown>;
    return {
      status: typeof value.s === 'string' ? value.s : 'unknown',
      downloadedBytes: number(value.d),
      totalBytes: number(value.t),
      etaSeconds: number(value.e),
      speed: number(value.v),
    };
  } catch {
    return null;
  }
}
