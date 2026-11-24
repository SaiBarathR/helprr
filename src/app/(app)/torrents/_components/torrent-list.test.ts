import { describe, expect, it } from 'vitest';
import { formatBytes, formatSpeed, matchesTorrentFilter, torrentStateBadge } from './torrent-list';
import { torrentCounters } from '@/lib/qbittorrent-summary';
import type { QBittorrentTorrent } from '@/types';

describe('formatBytes', () => {
  it('shows an unknown size as "—", as qBittorrent reports -1 while it fetches metadata', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });

  it('formats known sizes as before', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatSpeed(1048576)).toBe('1 MB/s');
    expect(formatBytes(0.5)).toBe('0.5 B');
    expect(formatBytes(1024 ** 5)).toBe('1024 TB');
  });
});

describe('torrent states', () => {
  const torrent = (state: string) => ({ state, progress: 0, dlspeed: 0, upspeed: 0 }) as QBittorrentTorrent;

  it.each(['metaDL', 'forcedMetaDL', 'allocating', 'forcedDL', 'stalledDL', 'queuedDL', 'checkingDL', 'downloading'])(
    'shows %s under Downloading and counts it there',
    (state) => {
      expect(matchesTorrentFilter(torrent(state), 'downloading')).toBe(true);
      expect(torrentCounters([torrent(state)]).downloading).toBe(1);
    },
  );

  it('puts every state in the same filter as its counter', () => {
    const states = ['downloading', 'metaDL', 'forcedMetaDL', 'allocating', 'stalledDL', 'queuedDL', 'checkingDL', 'forcedDL',
      'uploading', 'stalledUP', 'queuedUP', 'checkingUP', 'forcedUP', 'pausedDL', 'pausedUP', 'stoppedDL', 'stoppedUP',
      'checkingResumeData', 'moving', 'missingFiles', 'error', 'unknown'];
    for (const state of states) {
      const counters = torrentCounters([torrent(state)]);
      expect([state, matchesTorrentFilter(torrent(state), 'downloading')]).toEqual([state, counters.downloading === 1]);
      expect([state, matchesTorrentFilter(torrent(state), 'seeding')]).toEqual([state, counters.seeding === 1]);
      expect([state, matchesTorrentFilter(torrent(state), 'paused')]).toEqual([state, counters.paused === 1]);
    }
  });

  it.each([
    ['metaDL', 'Metadata'],
    ['forcedMetaDL', 'Forced meta'],
    ['allocating', 'Allocating'],
    ['checkingResumeData', 'Checking'],
    ['moving', 'Moving'],
    ['missingFiles', 'Missing'],
    ['error', 'Error'],
    ['unknown', 'Unknown'],
    ['stoppedDL', 'Stopped'],
    ['stoppedUP', 'Stopped'],
  ])('labels %s as %s', (state, label) => {
    expect(torrentStateBadge(state).label).toBe(label);
  });

  it('shows a state it does not know as sent', () => {
    expect(torrentStateBadge('somethingNew')).toEqual({ label: 'somethingNew', variant: 'secondary' });
  });
});
