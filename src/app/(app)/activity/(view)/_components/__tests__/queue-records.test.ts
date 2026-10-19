import { describe, expect, it } from 'vitest';
import {
  appNameFor,
  canManualImport,
  downloadSiblings,
  episodeLabel,
  formatBytes,
  getQueueCustomFormats,
  getQueueItemQuality,
  getQueueMediaHref,
  groupQueueByDownload,
  manualImportHref,
  packNoun,
  queueRecordKey,
  queueRemovalDelta,
  statusColor,
  statusLabel,
  uniqueQueueRecords,
  type QueueRecord,
} from '../queue-records';

const record = (extra: Record<string, unknown> = {}) => ({
  id: 1, title: 'Release', status: 'downloading', trackedDownloadState: 'downloading', trackedDownloadStatus: 'ok',
  downloadId: 'HASH1', source: 'sonarr', size: 100, sizeleft: 50, ...extra,
}) as unknown as QueueRecord;

describe('queue record labels', () => {
  it('names an import problem or a failed download before the client status', () => {
    expect(statusLabel(record({ trackedDownloadState: 'importBlocked', status: 'paused' }))).toBe('MANUAL IMPORT');
    expect(statusLabel(record({ trackedDownloadState: 'importPending', trackedDownloadStatus: 'warning' }))).toBe('MANUAL IMPORT');
    expect(statusLabel(record({ trackedDownloadState: 'failedPending' }))).toBe('DOWNLOAD FAILED');
  });

  it('lets the client status win over a tracked state of downloading', () => {
    expect(statusLabel(record({ status: 'paused' }))).toBe('PAUSED');
    expect(statusLabel(record({ status: 'queued' }))).toBe('QUEUED');
    expect(statusLabel(record({ status: 'delay' }))).toBe('DELAYED');
    expect(statusLabel(record())).toBe('DOWNLOADING');
    expect(statusLabel(record({ trackedDownloadState: 'importPending' }))).toBe('IMPORT PENDING');
    expect(statusLabel(record({ trackedDownloadState: undefined, status: 'completed' }))).toBe('COMPLETED');
    expect(statusLabel(record({ trackedDownloadState: 'ignored', status: 'warning' }))).toBe('IGNORED');
    expect(statusLabel(record({ trackedDownloadState: undefined, status: undefined }))).toBe('UNKNOWN');
  });

  it('colours a badge by the tracked status first: a warning, then an error, then the client status', () => {
    expect(statusColor('failed', 'warning')).toContain('text-orange-500');
    expect(statusColor('completed', 'error')).toContain('text-red-500');
    expect(statusColor('warning')).toContain('text-orange-500');
    expect(statusColor('failed')).toContain('text-red-500');
    expect(statusColor('imported', 'ok')).toContain('text-green-500');
    expect(statusColor('downloading')).toContain('text-blue-500');
    expect(statusColor('delay')).toContain('text-yellow-500');
    expect(statusColor('paused')).toContain('text-muted-foreground');
  });

  it('names what a pack holds, and the app behind a record', () => {
    expect([packNoun('lidarr'), packNoun('sonarr'), packNoun('radarr'), packNoun(undefined)]).toEqual(['tracks', 'episodes', 'items', 'items']);
    expect([appNameFor('radarr'), appNameFor('lidarr'), appNameFor('sonarr'), appNameFor(undefined)]).toEqual(['Radarr', 'Lidarr', 'Sonarr', 'Sonarr']);
  });

  it('formats sizes, quality, custom formats and episode labels', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5 GB');
    expect(getQueueItemQuality(record({ quality: { quality: { name: 'WEBDL-1080p' } } }))).toBe('WEBDL-1080p');
    expect(getQueueItemQuality(record({ movie: { movieFile: { quality: { quality: { name: 'Bluray-2160p' } } } } }))).toBe('Bluray-2160p');
    expect(getQueueCustomFormats(record({ customFormats: [{ name: 'HDR' }, { name: '' }, { name: 'DV' }] }))).toBe('HDR, DV');
    expect(getQueueCustomFormats(record({ customFormats: [] }))).toBeUndefined();
    expect(episodeLabel(record({ episode: { seasonNumber: 2, episodeNumber: 5 } }))).toBe('S02E05');
    expect(episodeLabel(record({ seasonNumber: 0, episodeNumber: 3 }))).toBe('S00E03');
    expect(episodeLabel(record({ episodeNumber: 7 }))).toBe('E07');
    expect(episodeLabel(record())).toBe('');
  });
});

describe('queue record links', () => {
  it('links the most specific page it knows, on the record\'s instance', () => {
    expect(getQueueMediaHref(record({ seriesId: 4, seasonNumber: 1, episodeId: 9, instanceId: 'i2' }))).toBe('/series/4/season/1/episode/9?instance=i2');
    expect(getQueueMediaHref(record({ series: { id: 4 }, episode: { seasonNumber: 2 } }))).toBe('/series/4/season/2');
    expect(getQueueMediaHref(record({ seriesId: 4, seasonNumber: 0, episodeId: 9 }))).toBe('/series/4/season/0/episode/9');
    expect(getQueueMediaHref(record({ series: { id: 4 }, episode: { seasonNumber: 0 } }))).toBe('/series/4/season/0');
    expect(getQueueMediaHref(record({ source: 'radarr', movie: { id: 12 } }))).toBe('/movies/12');
    expect(getQueueMediaHref(record({ source: 'lidarr', albumId: 3, artistId: 8 }))).toBe('/music/album/3');
    expect(getQueueMediaHref(record({ source: 'lidarr', artist: { id: 8 } }))).toBe('/music/8');
    expect(getQueueMediaHref(record())).toBeNull();
  });

  it('opens the manual import page for this download, and only for Sonarr or Radarr', () => {
    const href = manualImportHref(record({ source: 'radarr', title: 'Film (2024)', movieId: 12, instanceId: 'i2' }));
    expect(href.startsWith('/activity/import?')).toBe(true);
    expect(Object.fromEntries(new URLSearchParams(href.split('?')[1]))).toEqual({
      downloadId: 'HASH1', source: 'radarr', title: 'Film (2024)', movieId: '12', instanceId: 'i2',
    });
    expect(new URLSearchParams(manualImportHref(record({ source: undefined, seriesId: 4 })).split('?')[1]).get('source')).toBe('sonarr');
    const blocked = { trackedDownloadState: 'importBlocked' };
    expect(canManualImport(record(blocked))).toBe(true);
    expect(canManualImport(record({ ...blocked, source: 'radarr' }))).toBe(true);
    expect(canManualImport(record({ ...blocked, source: 'lidarr' }))).toBe(false);
    expect(canManualImport(record())).toBe(false);
  });
});

describe('queue record grouping', () => {
  it('groups a season pack by download on its own source and instance, in arrival order', () => {
    const items = [
      record({ id: 1, downloadId: 'PACK' }),
      record({ id: 2, downloadId: undefined }),
      record({ id: 3, downloadId: 'PACK' }),
      record({ id: 4, downloadId: 'PACK', instanceId: 'other' }),
      record({ id: 5, downloadId: 'PACK', source: 'radarr' }),
    ];
    const groups = groupQueueByDownload(items);
    expect(groups.map((g) => [g.items.map((i) => i.id), g.rep.id, g.isPack])).toEqual([
      [[1, 3], 1, true],
      [[2], 2, false],
      [[4], 4, false],
      [[5], 5, false],
    ]);
    expect(new Set(groups.map((g) => g.key)).size).toBe(groups.length);
    expect(downloadSiblings(items, items[2]).map((i) => i.id)).toEqual([1, 3]);
    expect(downloadSiblings(items, items[1]).map((i) => i.id)).toEqual([2]);
  });

  it('keys a record by source, instance and id, and drops repeats', () => {
    expect(queueRecordKey({ id: 7 })).toBe('||7');
    expect(queueRecordKey({ source: 'radarr', instanceId: 'i2', id: 7 })).toBe('radarr|i2|7');
    const records = [record({ id: 7 }), record({ id: 7, source: 'radarr' }), record({ id: 7 }), record({ id: 7, instanceId: 'i2' })];
    expect(uniqueQueueRecords(records)).toEqual([records[0], records[1], records[3]]);
  });

  it('counts the records a removal takes off the badge, and those needing attention', () => {
    expect(queueRemovalDelta([
      record(),
      record({ trackedDownloadState: 'importBlocked' }),
      record({ trackedDownloadState: 'failed' }),
      record({ trackedDownloadState: 'importPending', trackedDownloadStatus: 'ok' }),
    ])).toEqual({ count: 4, attention: 2 });
  });
});
