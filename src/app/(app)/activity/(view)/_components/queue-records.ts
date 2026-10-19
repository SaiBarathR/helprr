import type { QueueItem } from '@/types';
import { classifyQueueIssue } from '@/lib/queue-state';

export function statusColor(status: string, tracked?: string) {
  if (tracked === 'warning' || status === 'warning') return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
  if (tracked === 'error' || status === 'failed') return 'bg-red-500/10 text-red-500 border-red-500/20';
  if (status === 'completed' || status === 'imported') return 'bg-green-500/10 text-green-500 border-green-500/20';
  if (status === 'downloading') return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
  if (status === 'queued' || status === 'delay') return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
  return 'bg-muted text-muted-foreground border-muted';
}

export function statusLabel(item: QueueItem & { source?: string }) {
  const issue = classifyQueueIssue(item.trackedDownloadState, item.trackedDownloadStatus);
  if (issue === 'import') return 'MANUAL IMPORT';
  if (issue === 'download') return 'DOWNLOAD FAILED';
  // Download-client status wins over the tracked state: a paused/queued item can
  // still report trackedDownloadState 'downloading' upstream.
  if (item.status === 'paused') return 'PAUSED';
  if (item.status === 'queued') return 'QUEUED';
  if (item.status === 'delay') return 'DELAYED';
  if (item.trackedDownloadState === 'importing') return 'IMPORTING';
  if (item.trackedDownloadState === 'importPending') return 'IMPORT PENDING';
  if (item.trackedDownloadState === 'downloading') return 'DOWNLOADING';
  if (item.status === 'completed') return 'COMPLETED';
  return (item.trackedDownloadState || item.status || 'UNKNOWN').toUpperCase();
}

export function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function getQueueItemQuality(item: QueueItem): string | undefined {
  return item.quality?.quality?.name || item.movie?.movieFile?.quality?.quality?.name;
}

export function getQueueCustomFormats(item: QueueItem): string | undefined {
  const names = item.customFormats?.map((format) => format.name).filter(Boolean);
  return names && names.length > 0 ? names.join(', ') : undefined;
}

export function getQueueMediaHref(item: QueueItem & { source?: string }): string | null {
  const q = item.instanceId ? `?instance=${item.instanceId}` : '';
  const seriesId = item.seriesId ?? item.series?.id;
  const seasonNumber = item.seasonNumber ?? item.episode?.seasonNumber;
  const episodeId = item.episodeId ?? item.episode?.id;
  if (seriesId && seasonNumber != null && episodeId) {
    return `/series/${seriesId}/season/${seasonNumber}/episode/${episodeId}${q}`;
  }
  if (seriesId && seasonNumber != null) {
    return `/series/${seriesId}/season/${seasonNumber}${q}`;
  }
  if (seriesId) {
    return `/series/${seriesId}${q}`;
  }
  const movieId = item.movieId ?? item.movie?.id;
  if (movieId) {
    return `/movies/${movieId}${q}`;
  }
  const albumId = item.albumId ?? item.album?.id;
  if (albumId) {
    return `/music/album/${albumId}${q}`;
  }
  const artistId = item.artistId ?? item.artist?.id;
  if (artistId) {
    return `/music/${artistId}${q}`;
  }
  return null;
}

/** The manual import page for a queue item's download. */
export function manualImportHref(item: QueueItem & { source?: string }): string {
  const params = new URLSearchParams({
    downloadId: item.downloadId,
    source: item.source || 'sonarr',
    title: item.title || '',
  });
  if (item.seriesId) params.set('seriesId', String(item.seriesId));
  if (item.movieId) params.set('movieId', String(item.movieId));
  if (item.instanceId) params.set('instanceId', item.instanceId);
  return `/activity/import?${params}`;
}

export function needsManualImport(item: QueueItem): boolean {
  return classifyQueueIssue(item.trackedDownloadState, item.trackedDownloadStatus) === 'import';
}

/** Needs an import the import page can do: it handles Sonarr and Radarr only. */
export function canManualImport(item: QueueItem & { source?: string }): boolean {
  return (item.source === 'sonarr' || item.source === 'radarr') && needsManualImport(item);
}

// --- Season-pack grouping ---

export type QueueRecord = QueueItem & { source?: string };

interface QueueGroup {
  key: string;
  items: QueueRecord[];
  rep: QueueRecord; // representative record: every record shares the torrent's size/status/progress
  isPack: boolean; // more than one tracked item in the same download (e.g. a season pack)
}

/**
 * Group queue records that belong to the same physical download. Sonarr returns
 * one queue record per episode for a season-pack torrent, all sharing the same
 * `downloadId`; collapsing them into a single group keeps the list readable.
 * Records without a downloadId, and single-item downloads, stay on their own.
 * Insertion order is preserved so the caller can sort groups by their rep.
 */
export function groupQueueByDownload(items: QueueRecord[]): QueueGroup[] {
  const groups = new Map<string, QueueRecord[]>();
  const order: string[] = [];
  for (const item of items) {
    const key = item.downloadId
      ? `dl-${item.source}-${item.instanceId ?? ''}-${item.downloadId}`
      : `solo-${item.source}-${item.id}`;
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
      order.push(key);
    }
    bucket.push(item);
  }
  return order.map((key) => {
    const bucket = groups.get(key)!;
    return { key, items: bucket, rep: bucket[0], isPack: bucket.length > 1 };
  });
}

/** Short SxxExx label for a queue record, falling back to the bare episode number. */
export function episodeLabel(item: QueueRecord): string {
  const season = item.episode?.seasonNumber ?? item.seasonNumber;
  const number = item.episode?.episodeNumber ?? item.episodeNumber;
  if (season != null && number != null) {
    return `S${String(season).padStart(2, '0')}E${String(number).padStart(2, '0')}`;
  }
  if (number != null) return `E${String(number).padStart(2, '0')}`;
  return '';
}

/** Noun for the items collapsed into a download group, by source (Lidarr ships tracks, not episodes). */
export function packNoun(source?: string): string {
  if (source === 'lidarr') return 'tracks';
  if (source === 'sonarr') return 'episodes';
  return 'items';
}

/** Display name of the *arr app behind a queue record, for the remove dialog's hint copy. */
export function appNameFor(source?: string): string {
  if (source === 'radarr') return 'Radarr';
  if (source === 'lidarr') return 'Lidarr';
  return 'Sonarr';
}

// The Queue tab loads each instance's queue QUEUE_PAGE_SIZE downloads at a time.
export const QUEUE_QUERY_KEY = ['activity', 'queue', 'pages'] as const;

export const QUEUE_PAGE_SIZE = 50;

export type QueuePage = { records?: QueueRecord[]; totalRecords: number };

/** Queue ids are only unique per *arr instance, so a record's identity includes its source and instance. */
export function queueRecordKey(rec: { source?: string; instanceId?: string; id: number }): string {
  return `${rec.source ?? ''}|${rec.instanceId ?? ''}|${rec.id}`;
}

export function uniqueQueueRecords(records: QueueRecord[]): QueueRecord[] {
  const seen = new Set<string>();
  return records.filter((rec) => {
    const key = queueRecordKey(rec);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** What the remove dialog is acting on: a single queue record or a whole season-pack group. */
export type RemoveTarget =
  | { kind: 'item'; item: QueueRecord }
  | { kind: 'pack'; group: QueueGroup };

/** All queue records sharing `item`'s physical download (≥1, includes item). */
export function downloadSiblings(queue: QueueRecord[], item: QueueRecord): QueueRecord[] {
  if (!item.downloadId) return [item];
  return queue.filter(
    (q) =>
      q.downloadId === item.downloadId &&
      q.source === item.source &&
      (q.instanceId ?? '') === (item.instanceId ?? ''),
  );
}

/** Badge delta for removing a whole download: total = record count, attention = flagged subset. */
export function queueRemovalDelta(items: QueueRecord[]): { count: number; attention: number } {
  return {
    count: items.length,
    attention: items.filter(
      (it) => classifyQueueIssue(it.trackedDownloadState, it.trackedDownloadStatus) !== null,
    ).length,
  };
}
