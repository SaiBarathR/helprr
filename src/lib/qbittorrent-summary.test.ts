import { describe, expect, it } from 'vitest';
import { projectTorrentsForSummary, torrentCounters, passiveTorrentRefreshIntervalMs } from './qbittorrent-summary';
import type { QBittorrentTorrent } from '@/types';
describe('torrent transfer projections', () => {
  it('carries what the table columns show, and the tracker as its host name only', () => {
    const source = {
      hash: 'h', name: 'n', tags: 'a, b', added_on: 10, completion_on: 20, last_activity: 30, save_path: '/downloads',
      availability: 1.5, downloaded: 4, uploaded: 5, max_ratio: 2, max_seeding_time: 60,
      tracker: 'https://tracker.example:8443/abc123passkey/announce', magnet_uri: 'magnet:?tr=abc123passkey',
    } as unknown as QBittorrentTorrent;
    const [projected] = projectTorrentsForSummary([source]);
    expect(projected).toMatchObject({
      tags: 'a, b', added_on: 10, completion_on: 20, last_activity: 30, save_path: '/downloads',
      availability: 1.5, downloaded: 4, uploaded: 5, max_ratio: 2, max_seeding_time: 60, tracker_host: 'tracker.example',
    });
    expect(JSON.stringify(projected)).not.toContain('passkey');
  });
  it.each([-1, 0, 2048])('preserves total_size %i so metadata availability reaches the list', (totalSize) => {
    const source = { hash: 'metadata', size: 0, total_size: totalSize } as QBittorrentTorrent;
    expect(projectTorrentsForSummary([source])[0].total_size).toBe(totalSize);
  });
  it.each([100, 1000, 5000])('preserves list state and makes counters independent of %i rows', (count) => {
    const source = Array.from({ length: count }, (_, index) => ({ hash: String(index), name: `Torrent ${index}`, state: index % 2 ? 'downloading' : 'stoppedUP', progress: index / count, unusedUpstreamMetadata: 'x'.repeat(2000) } as unknown as QBittorrentTorrent));
    const list = projectTorrentsForSummary(source);
    const counters = torrentCounters(list);
    expect(counters).toEqual({ total: count, downloading: count / 2, seeding: 0, paused: count / 2 });
    expect(list[10].hash).toBe(source[10].hash);
    expect(list[10].progress).toBe(source[10].progress);
    expect(JSON.stringify(list)).not.toContain('unusedUpstreamMetadata');
    expect(JSON.stringify(counters).length).toBeLessThan(100);
    console.info(JSON.stringify({ fixture: 'torrents', count, upstreamBytes: JSON.stringify(source).length, listBytes: JSON.stringify(list).length, counterBytes: JSON.stringify(counters).length }));
  });
  it('slows passive refresh only when explicit data-saver or very slow hints exist', () => {
    expect(passiveTorrentRefreshIntervalMs(5000)).toBe(5000);
    expect(passiveTorrentRefreshIntervalMs(5000, { saveData: true })).toBe(15000);
    expect(passiveTorrentRefreshIntervalMs(5000, { effectiveType: '4g' })).toBe(5000);
  });
});
