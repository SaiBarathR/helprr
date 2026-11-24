import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatSpeed,
  matchesTorrentFacets,
  matchesTorrentFilter,
  mergeTorrents,
  torrentFacetOptions,
  torrentStateBadge,
  type TorrentFacetFilters,
} from './torrent-list';
import { torrentCounters } from '@/lib/qbittorrent-summary';
import type { QBittorrentTorrent } from '@/types';
import type { TorrentsFilterPreference } from '@/lib/store';

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

describe('qBittorrent status filters', () => {
  const ALL_STATES = ['downloading', 'metaDL', 'forcedMetaDL', 'allocating', 'stalledDL', 'queuedDL', 'checkingDL', 'forcedDL',
    'uploading', 'stalledUP', 'queuedUP', 'checkingUP', 'forcedUP', 'pausedDL', 'pausedUP', 'stoppedDL', 'stoppedUP',
    'checkingResumeData', 'moving', 'missingFiles', 'error', 'unknown'];
  const torrent = (state: string, upspeed = 0) => ({ state, progress: 0, dlspeed: 0, upspeed }) as QBittorrentTorrent;
  const matching = (filter: TorrentsFilterPreference, upspeed = 0) =>
    ALL_STATES.filter((state) => matchesTorrentFilter(torrent(state, upspeed), filter));

  // As qBittorrent's TorrentFilter::matchState lists them.
  it('lists the states qBittorrent lists for each filter', () => {
    expect(matching('stalled')).toEqual(['stalledDL', 'stalledUP']);
    expect(matching('checking')).toEqual(['checkingDL', 'checkingUP', 'checkingResumeData']);
    expect(matching('moving')).toEqual(['moving']);
    expect(matching('errored')).toEqual(['missingFiles', 'error']);
    expect(matching('active')).toEqual(['downloading', 'metaDL', 'forcedMetaDL', 'forcedDL', 'uploading', 'forcedUP', 'moving']);
    expect(matching('running')).toEqual(ALL_STATES.filter((state) => !/^(paused|stopped)(DL|UP)$/.test(state)));
  });

  it('counts a stalled download that still uploads as active, as qBittorrent does', () => {
    expect(matching('active', 1)).toContain('stalledDL');
    expect(matching('inactive', 1)).not.toContain('stalledDL');
  });

  it('splits every torrent between Active and Inactive, and between Running and Paused', () => {
    for (const upspeed of [0, 1]) {
      for (const state of ALL_STATES) {
        const t = torrent(state, upspeed);
        expect([state, matchesTorrentFilter(t, 'active')]).toEqual([state, !matchesTorrentFilter(t, 'inactive')]);
        expect([state, matchesTorrentFilter(t, 'running')]).toEqual([state, !matchesTorrentFilter(t, 'paused')]);
      }
    }
  });
});

describe('category, tag and tracker filters', () => {
  const torrent = (hash: string, category: string, tags: string, tracker_host?: string) =>
    ({ hash, category, tags, tracker_host }) as QBittorrentTorrent;
  const anime = torrent('a', 'anime', 'hevc, private', 'tracker.one.invalid');
  const movie = torrent('b', 'movies', 'hevc', 'tracker.two.invalid');
  const bare = torrent('c', '', '', '');
  const none: TorrentFacetFilters = { categories: [], tags: [], trackers: [] };
  const hashes = (filters: Partial<typeof none>) =>
    [anime, movie, bare].filter((t) => matchesTorrentFacets(t, { ...none, ...filters })).map((t) => t.hash);

  it('keeps every torrent while nothing is picked', () => {
    expect(hashes({})).toEqual(['a', 'b', 'c']);
  });

  it('matches any picked value of a group, and "none" as the empty value', () => {
    expect(hashes({ categories: ['anime', 'movies'] })).toEqual(['a', 'b']);
    expect(hashes({ categories: [''] })).toEqual(['c']);
    expect(hashes({ tags: ['private'] })).toEqual(['a']);
    expect(hashes({ tags: ['hevc'] })).toEqual(['a', 'b']);
    expect(hashes({ tags: [''] })).toEqual(['c']);
    expect(hashes({ trackers: ['tracker.two.invalid', ''] })).toEqual(['b', 'c']);
    // A row from an older server without the field has no tracker.
    expect(matchesTorrentFacets(torrent('d', '', ''), { ...none, trackers: [''] })).toBe(true);
  });

  it('narrows by every group at once', () => {
    expect(hashes({ tags: ['hevc'], trackers: ['tracker.two.invalid'] })).toEqual(['b']);
    expect(hashes({ categories: ['anime'], tags: [''] })).toEqual([]);
  });

  it('offers the values the torrents have, "none" first, and keeps a picked value no torrent has', () => {
    expect(torrentFacetOptions([anime, movie, bare], none)).toEqual({
      categories: ['', 'anime', 'movies'],
      tags: ['', 'hevc', 'private'],
      trackers: ['', 'tracker.one.invalid', 'tracker.two.invalid'],
    });
    expect(torrentFacetOptions([movie], { ...none, categories: ['gone'] }).categories).toEqual(['gone', 'movies']);
  });

  it('offers no group where no torrent has a value', () => {
    expect(torrentFacetOptions([bare], none)).toEqual({ categories: [], tags: [], trackers: [] });
    expect(torrentFacetOptions([bare], { ...none, tags: [''] }).tags).toEqual(['']);
  });

  it('updates a row when only its tracker changes', () => {
    const prev = [anime];
    expect(mergeTorrents(prev, [{ ...anime, tracker_host: 'other.invalid' }])[0].tracker_host).toBe('other.invalid');
  });
});
