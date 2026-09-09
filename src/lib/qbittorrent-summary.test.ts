import { describe, expect, it } from 'vitest';
import { projectTorrentsForSummary, torrentCounters, passiveTorrentRefreshIntervalMs } from './qbittorrent-summary';
import type { QBittorrentTorrent } from '@/types';
describe('torrent transfer projections', () => {
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
