import { describe, expect, it } from 'vitest';
import type { TorrentTracker } from '@/lib/qbittorrent-client';
import { realTrackers, trackerCount, trackerStatusLabel } from './torrent-trackers';

function tracker(url: string, status = 2): TorrentTracker {
  return { url, status, tier: 0, num_peers: 0, num_seeds: 0, num_leeches: 0, num_downloaded: 0, msg: '' };
}

describe('realTrackers', () => {
  it('keeps udp, http(s) and wss trackers and drops the DHT, PeX and LSD pseudo-entries', () => {
    const list = [
      tracker('** [DHT] **', 0),
      tracker('** [PeX] **', 0),
      tracker('** [LSD] **', 0),
      tracker('udp://tracker.opentrackr.org:1337/announce'),
      tracker('http://tracker.example.org/announce'),
      tracker('https://tracker.example.org/announce'),
      tracker('wss://tracker.webtorrent.dev'),
    ];
    expect(realTrackers(list).map((t) => t.url)).toEqual([
      'udp://tracker.opentrackr.org:1337/announce',
      'http://tracker.example.org/announce',
      'https://tracker.example.org/announce',
      'wss://tracker.webtorrent.dev',
    ]);
  });
});

describe('trackerStatusLabel', () => {
  it('names every qBittorrent tracker status', () => {
    expect(trackerStatusLabel(0)).toBe('Disabled');
    expect(trackerStatusLabel(1)).toBe('Not contacted');
    expect(trackerStatusLabel(2)).toBe('Working');
    expect(trackerStatusLabel(3)).toBe('Updating');
    expect(trackerStatusLabel(4)).toBe('Not working');
    expect(trackerStatusLabel(9)).toBe('Unknown');
  });
});

describe('trackerCount', () => {
  it('shows N/A for the -1 qBittorrent reports before a tracker answers', () => {
    expect(trackerCount(-1)).toBe('N/A');
    expect(trackerCount(0)).toBe('0');
    expect(trackerCount(42)).toBe('42');
  });
});
