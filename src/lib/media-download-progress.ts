import type { QueueItem } from '@/types';

export type MediaQueueSource = 'sonarr' | 'radarr';

export function filterQueueItemsForMedia(
  records: readonly QueueItem[],
  source: MediaQueueSource,
  mediaId: number,
  instanceId: string,
): QueueItem[] {
  return records.filter((record) => {
    if (record.source !== source || record.instanceId !== instanceId) return false;
    if (source === 'radarr') {
      return record.movieId === mediaId || record.movie?.id === mediaId;
    }
    return record.seriesId === mediaId || record.series?.id === mediaId;
  });
}

export type MediaDownloadTone = 'downloading' | 'queued' | 'importing' | 'warning' | 'error';

export interface MediaDownloadItem {
  key: string;
  title: string;
  statusLabel: string;
  tone: MediaDownloadTone;
  episodeLabel: string | null;
  quality: string | null;
  downloadClient: string | null;
  size: number;
  sizeleft: number;
  progress: number;
  timeLeft: string | null;
  message: string | null;
}

export interface MediaDownloadSummary {
  items: MediaDownloadItem[];
  count: number;
  totalSize: number;
  remainingSize: number;
  progress: number | null;
}

/**
 * *arr `timeleft` is a .NET TimeSpan string — `hh:mm:ss` or `d.hh:mm:ss`
 * (e.g. `10.14:40:12`). Reduce it to the two largest units for display.
 */
export function humanizeTimeLeft(value: string | null | undefined): string | null {
  const match = value?.trim().match(/^(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, d, h, m, s] = match;
  const parts: Array<[number, string]> = [
    [Number(d ?? 0), 'd'],
    [Number(h), 'h'],
    [Number(m), 'm'],
    [Number(s), 's'],
  ];
  const firstIndex = parts.findIndex(([amount]) => amount > 0);
  if (firstIndex === -1) return null;
  const kept = parts
    .slice(firstIndex, firstIndex + 2)
    .filter(([amount]) => amount > 0)
    .map(([amount, unit]) => `${amount}${unit}`);
  return kept.join(' ');
}

function statusInfo(item: QueueItem): { label: string; tone: MediaDownloadTone } {
  if (item.trackedDownloadStatus === 'error' || item.status === 'failed') {
    return { label: 'Failed', tone: 'error' };
  }
  if (item.trackedDownloadStatus === 'warning' || item.status === 'warning') {
    return { label: 'Stalled', tone: 'warning' };
  }
  if (item.status === 'paused') return { label: 'Paused', tone: 'queued' };
  if (item.status === 'queued') return { label: 'Queued', tone: 'queued' };
  if (item.status === 'delay') return { label: 'Delayed', tone: 'queued' };
  if (item.trackedDownloadState === 'importing') return { label: 'Importing', tone: 'importing' };
  if (item.trackedDownloadState === 'importPending') {
    return { label: 'Import pending', tone: 'importing' };
  }
  if (item.status === 'downloading' || item.trackedDownloadState === 'downloading') {
    return { label: 'Downloading', tone: 'downloading' };
  }
  if (item.status === 'completed') return { label: 'Completed', tone: 'importing' };
  return { label: item.status || 'Unknown', tone: 'queued' };
}

/** "S01E03" for one episode; "Season 1 · 8 episodes" for a pack. */
function episodeLabel(records: readonly QueueItem[]): string | null {
  const episodes = records.filter(
    (r) => r.seasonNumber != null && (r.episodeNumber != null || r.episode?.episodeNumber != null),
  );
  if (episodes.length === 0) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (episodes.length === 1) {
    const record = episodes[0];
    const episode = record.episodeNumber ?? record.episode?.episodeNumber;
    return `S${pad(record.seasonNumber!)}E${pad(episode!)}`;
  }
  const seasons = new Set(episodes.map((r) => r.seasonNumber));
  const scope = seasons.size === 1 ? `Season ${episodes[0].seasonNumber}` : 'Multiple seasons';
  return `${scope} · ${episodes.length} episodes`;
}

export function summarizeMediaDownloads(records: readonly QueueItem[]): MediaDownloadSummary | null {
  const grouped = new Map<string, QueueItem[]>();
  for (const record of records) {
    const key = record.downloadId
      ? `${record.source}:${record.instanceId}:${record.downloadId}`
      : `${record.source}:${record.instanceId}:queue:${record.id}`;
    const list = grouped.get(key);
    if (list) list.push(record);
    else grouped.set(key, [record]);
  }

  if (grouped.size === 0) return null;

  const items: MediaDownloadItem[] = [];
  let totalSize = 0;
  let remainingSize = 0;

  for (const [key, group] of grouped) {
    // Season-pack episode rows repeat the same download; the largest-size row
    // carries the full pack size and the truest remaining figure.
    const representative = group.reduce((best, record) => (record.size > best.size ? record : best));
    const size = Math.max(0, representative.size || 0);
    const remaining = Math.max(0, Math.min(representative.sizeleft || 0, size || Number.MAX_SAFE_INTEGER));
    totalSize += size;
    remainingSize += remaining;

    const { label, tone } = statusInfo(representative);
    items.push({
      key,
      title: representative.title,
      statusLabel: label,
      tone,
      episodeLabel: representative.source === 'sonarr' ? episodeLabel(group) : null,
      quality: representative.quality?.quality?.name ?? null,
      downloadClient: representative.downloadClient || null,
      size,
      sizeleft: remaining,
      progress: size > 0 ? Math.max(0, Math.min(100, ((size - remaining) / size) * 100)) : 0,
      timeLeft: humanizeTimeLeft(representative.timeleft),
      message:
        representative.errorMessage
        || representative.statusMessages?.[0]?.messages?.[0]
        || representative.statusMessages?.[0]?.title
        || null,
    });
  }

  const progress = totalSize > 0
    ? Math.max(0, Math.min(100, ((totalSize - remainingSize) / totalSize) * 100))
    : null;

  return { items, count: items.length, totalSize, remainingSize, progress };
}

export interface SpeedSample {
  /** Remaining bytes at the delta baseline. */
  sizeleft: number;
  /** Timestamp of the delta baseline (last poll where bytes moved). */
  at: number;
  /** Bytes/second, or null when never measured or expired. */
  speed: number | null;
  measuredAt: number;
}

/** How long a measured speed survives polls where upstream stats are unchanged. */
export const SPEED_HOLD_MS = 45_000;

/**
 * Bytes/second per download, derived from remaining-bytes deltas between
 * polls (the queue API doesn't report speed). Upstream queue stats refresh
 * slower than the poll interval, so unchanged polls keep the previous delta
 * baseline (averaging across the gap) and hold the last measured speed for
 * `SPEED_HOLD_MS` before treating the download as stalled.
 */
export function trackTransferSpeeds(
  previous: Readonly<Record<string, SpeedSample>> | undefined,
  items: readonly MediaDownloadItem[],
  at: number,
): Record<string, SpeedSample> {
  const next: Record<string, SpeedSample> = {};
  for (const item of items) {
    const before = previous?.[item.key];
    if (before && at > before.at && item.sizeleft < before.sizeleft) {
      next[item.key] = {
        sizeleft: item.sizeleft,
        at,
        speed: ((before.sizeleft - item.sizeleft) / (at - before.at)) * 1000,
        measuredAt: at,
      };
    } else if (before && item.sizeleft === before.sizeleft) {
      const held = before.speed !== null && at - before.measuredAt <= SPEED_HOLD_MS;
      next[item.key] = { ...before, speed: held ? before.speed : null };
    } else {
      next[item.key] = { sizeleft: item.sizeleft, at, speed: null, measuredAt: 0 };
    }
  }
  return next;
}
