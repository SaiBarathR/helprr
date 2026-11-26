import { describe, expect, it } from 'vitest';
import type { QueueItem } from '@/types';
import {
  filterQueueItemsForMedia,
  humanizeTimeLeft,
  queueTimeLeftLabel,
  timeLeftSeconds,
  summarizeMediaDownloads,
} from './media-download-progress';

function queueItem(overrides: Partial<QueueItem>): QueueItem {
  return {
    id: 1,
    downloadId: 'download-1',
    title: 'Example.Release.1080p.WEB-DL',
    status: 'downloading',
    trackedDownloadStatus: 'ok',
    trackedDownloadState: 'downloading',
    statusMessages: [],
    errorMessage: '',
    timeleft: '00:10:00',
    estimatedCompletionTime: '',
    size: 100,
    sizeleft: 25,
    protocol: 'torrent',
    downloadClient: 'qBittorrent',
    indexer: '',
    outputPath: '',
    downloadForced: false,
    ...overrides,
  };
}

describe('media download progress', () => {
  it('matches media only within the exact service instance', () => {
    const records = [
      queueItem({ source: 'sonarr', instanceId: 'one', seriesId: 7 }),
      queueItem({ id: 2, source: 'sonarr', instanceId: 'two', seriesId: 7 }),
      queueItem({ id: 3, source: 'radarr', instanceId: 'one', movieId: 7 }),
    ];

    expect(filterQueueItemsForMedia(records, 'sonarr', 7, 'one')).toHaveLength(1);
  });

  it('groups season-pack episode rows into one download item', () => {
    const records = [
      queueItem({ id: 1, source: 'sonarr', instanceId: 'one', seriesId: 7, seasonNumber: 1, episodeNumber: 1 }),
      queueItem({ id: 2, source: 'sonarr', instanceId: 'one', seriesId: 7, seasonNumber: 1, episodeNumber: 2 }),
    ];

    const summary = summarizeMediaDownloads(records);
    expect(summary?.count).toBe(1);
    expect(summary?.totalSize).toBe(100);
    expect(summary?.remainingSize).toBe(25);
    expect(summary?.progress).toBe(75);
    expect(summary?.items[0]).toMatchObject({
      statusLabel: 'Downloading',
      tone: 'downloading',
      episodeLabel: 'Season 1 · 2 episodes',
      downloadClient: 'qBittorrent',
      timeLeft: '10m',
    });
  });

  it('labels a single episode and surfaces quality and stall state', () => {
    const summary = summarizeMediaDownloads([
      queueItem({
        source: 'sonarr',
        instanceId: 'one',
        seriesId: 7,
        seasonNumber: 1,
        episodeNumber: 3,
        trackedDownloadStatus: 'warning',
        quality: { quality: { id: 1, name: 'WEBDL-1080p' } },
        statusMessages: [{ title: 'Example', messages: ['The download is stalled'] }],
      }),
    ]);

    expect(summary?.items[0]).toMatchObject({
      statusLabel: 'Stalled',
      tone: 'warning',
      episodeLabel: 'S01E03',
      quality: 'WEBDL-1080p',
      message: 'The download is stalled',
    });
  });

  it('humanizes .NET TimeSpan values to the two largest units', () => {
    expect(humanizeTimeLeft('10.14:40:12')).toBe('10d 14h');
    expect(humanizeTimeLeft('01:02:03')).toBe('1h 2m');
    expect(humanizeTimeLeft('00:10:00')).toBe('10m');
    expect(humanizeTimeLeft('00:00:45')).toBe('45s');
    expect(humanizeTimeLeft('')).toBeNull();
    expect(humanizeTimeLeft(undefined)).toBeNull();
  });

  it('reads TimeSpans with fractional seconds, as a held release has', () => {
    expect(humanizeTimeLeft('1970.04:10:55.0718460')).toBe('1970d 4h');
    expect(humanizeTimeLeft('01:59:12.3456789')).toBe('1h 59m');
    expect(timeLeftSeconds('1.02:03:04.5')).toBe(((24 + 2) * 60 + 3) * 60 + 4);
    expect(timeLeftSeconds('-00:01:00')).toBeNull();
  });

  it('labels a held release by the wait until it is sent', () => {
    expect(queueTimeLeftLabel({ status: 'delay', timeleft: '3.04:10:55.0718460' })).toBe('in 3d 4h');
    expect(queueTimeLeftLabel({ status: 'downloading', timeleft: '00:12:00' })).toBe('12m');
    // Held with nothing left to wait (no download client yet): no label.
    expect(queueTimeLeftLabel({ status: 'downloadClientUnavailable', timeleft: '00:00:00' })).toBeNull();
  });
});
