export interface DownloadProgress {
  status: string;
  downloadedBytes: number | null;
  totalBytes: number | null;
  etaSeconds: number | null;
  speed: number | null;
}

export const YT_DLP_PROGRESS_TEMPLATE =
  'download:{"s":%(progress.status)j,"d":%(progress.downloaded_bytes)j,"t":%(progress.total_bytes)j,"te":%(progress.total_bytes_estimate)j,"e":%(progress.eta)j,"v":%(progress.speed)j}';

const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** One line of yt-dlp output: progress JSON, or null for anything else it prints. */
export function parseProgressLine(line: string): DownloadProgress | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{"s":')) return null;
  try {
    // yt-dlp prints a missing field as a bare NA, which is not JSON.
    const value = JSON.parse(trimmed.replace(/:NA(?=[,}])/g, ':null')) as Record<string, unknown>;
    const downloadedBytes = number(value.d);
    // A VOD is fragments, so its size is only ever an estimate until the end.
    const totalBytes = number(value.t) ?? number(value.te);
    const speed = number(value.v);
    const remaining = totalBytes !== null && downloadedBytes !== null ? totalBytes - downloadedBytes : null;
    return {
      status: typeof value.s === 'string' ? value.s : 'unknown',
      downloadedBytes,
      totalBytes,
      etaSeconds: number(value.e) ?? (speed && remaining !== null && remaining > 0 ? remaining / speed : null),
      speed,
    };
  } catch {
    return null;
  }
}
