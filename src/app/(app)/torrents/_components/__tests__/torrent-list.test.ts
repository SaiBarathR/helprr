import { describe, expect, it } from 'vitest';
import type { QBittorrentTorrent } from '@/types';
import {
  OPTIMISTIC_OVERRIDE_FIELD,
  OPTIMISTIC_ROW_PATCHES,
  compareTorrents,
  formatBytes,
  formatEta,
  formatSeedingTime,
  formatSpeed,
  matchesTorrentFilter,
  mergeTorrents,
  torrentActionMessage,
} from '../torrent-list';

const torrent = (extra: Partial<QBittorrentTorrent> = {}) => ({
  hash: 'a', name: 'Alpha', size: 100, progress: 0.5, dlspeed: 0, upspeed: 0, num_seeds: 1, num_leechs: 0,
  state: 'downloading', eta: 60, category: '', tags: '', added_on: 1, completion_on: 0, save_path: '/d',
  ratio: 0, downloaded: 50, uploaded: 0, amount_left: 50, priority: 1, time_active: 10, seeding_time: 0,
  dl_limit: 0, up_limit: 0, ...extra,
}) as QBittorrentTorrent;

describe('torrent list formatting', () => {
  it('names each action for one torrent and for a selection', () => {
    expect(torrentActionMessage('forceStart', 'single')).toBe('Force started');
    expect(torrentActionMessage('setCategory', 'bulk')).toBe('set category for');
    expect(torrentActionMessage('unknown', 'single')).toBe('Action successful');
    expect(torrentActionMessage('unknown', 'bulk')).toBe('Updated');
  });

  it('formats sizes, speeds, ETAs and seeding time', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1.25 * 1024 ** 3)).toBe('1.3 GB');
    expect(formatSpeed(2048)).toBe('2 KB/s');
    // qBittorrent reports 8640000 (100 days) for "unknown".
    expect(formatEta(8640000)).toBe('');
    expect(formatEta(0)).toBe('');
    expect(formatEta(45)).toBe('45s');
    expect(formatEta(125)).toBe('2m 5s');
    expect(formatEta(3725)).toBe('1h 2m');
    expect(formatSeedingTime(0)).toBe('-');
    expect(formatSeedingTime(30)).toBe('0m');
    expect(formatSeedingTime(90061)).toBe('1d 1h 1m');
    expect(formatSeedingTime(86400)).toBe('1d');
  });
});

describe('torrent list filters and sorting', () => {
  it('matches each filter against qBittorrent 4 and 5 states', () => {
    expect(matchesTorrentFilter(torrent({ state: 'stalledDL' }), 'downloading')).toBe(true);
    expect(matchesTorrentFilter(torrent({ state: 'stoppedUP' }), 'seeding')).toBe(true);
    expect(matchesTorrentFilter(torrent({ state: 'stoppedDL' }), 'paused')).toBe(true);
    expect(matchesTorrentFilter(torrent({ state: 'pausedUP' }), 'paused')).toBe(true);
    expect(matchesTorrentFilter(torrent({ state: 'uploading' }), 'downloading')).toBe(false);
    expect(matchesTorrentFilter(torrent({ progress: 1 }), 'completed')).toBe(true);
    expect(matchesTorrentFilter(torrent(), 'completed')).toBe(false);
    expect(matchesTorrentFilter(torrent({ upspeed: 1 }), 'active')).toBe(true);
    expect(matchesTorrentFilter(torrent(), 'active')).toBe(false);
    expect(matchesTorrentFilter(torrent({ state: 'error' }), 'all')).toBe(true);
  });

  it('compares by text and by number', () => {
    expect(compareTorrents(torrent({ name: 'alpha' }), torrent({ name: 'Beta' }), 'name')).toBeLessThan(0);
    expect(compareTorrents(torrent({ category: 'tv' }), torrent({ category: '' }), 'category')).toBeGreaterThan(0);
    expect(compareTorrents(torrent({ size: 5 }), torrent({ size: 2 }), 'size')).toBe(3);
    expect(compareTorrents(torrent({ seeding_time: 1 }), torrent({ seeding_time: 4 }), 'seeding_time')).toBe(-3);
  });
});

describe('torrent list merging', () => {
  it.each([[-1, 0], [0, -1]])('updates a row when only metadata size changes from %i to %i', (before, after) => {
    const prev = [torrent({ total_size: before })];
    const next = [torrent({ total_size: after })];
    expect(mergeTorrents(prev, next)[0]).toBe(next[0]);
  });

  it('keeps the previous list, and each unchanged row, when a poll changes nothing', () => {
    const prev = [torrent({ hash: 'a' }), torrent({ hash: 'b' })];
    expect(mergeTorrents(prev, [torrent({ hash: 'a' }), torrent({ hash: 'b' })])).toBe(prev);
    const merged = mergeTorrents(prev, [torrent({ hash: 'a' }), torrent({ hash: 'b', progress: 0.7 })]);
    expect(merged).not.toBe(prev);
    expect(merged[0]).toBe(prev[0]);
    expect(merged[1].progress).toBe(0.7);
  });

  it('replaces a row when any field it shows or edits changes', () => {
    const changes: Partial<QBittorrentTorrent>[] = [
      { name: 'Beta' }, { size: 1 }, { progress: 1 }, { dlspeed: 1 }, { upspeed: 1 }, { num_seeds: 9 }, { num_leechs: 9 },
      { state: 'stalledDL' }, { eta: 1 }, { category: 'tv' }, { tags: 't' }, { added_on: 2 }, { completion_on: 2 },
      { save_path: '/e' }, { ratio: 1 }, { downloaded: 1 }, { uploaded: 1 }, { amount_left: 1 }, { priority: 2 },
      { time_active: 11 }, { seeding_time: 1 }, { dl_limit: 1 }, { up_limit: 1 },
    ];
    const prev = [torrent()];
    for (const change of changes) {
      expect(mergeTorrents(prev, [torrent(change)])[0], JSON.stringify(change)).toEqual(torrent(change));
    }
  });

  it('takes the new list when rows are added or removed, and ignores a reorder alone', () => {
    const prev = [torrent({ hash: 'a' }), torrent({ hash: 'b' })];
    expect(mergeTorrents(prev, [prev[0]]).map((t) => t.hash)).toEqual(['a']);
    expect(mergeTorrents(prev, [...prev, torrent({ hash: 'c' })]).map((t) => t.hash)).toEqual(['a', 'b', 'c']);
    // The page sorts the list itself, so qBittorrent's order does not matter.
    expect(mergeTorrents(prev, [torrent({ hash: 'b' }), torrent({ hash: 'a' })])).toBe(prev);
    const empty: QBittorrentTorrent[] = [];
    const next = [torrent()];
    expect(mergeTorrents(empty, next)).toBe(next);
  });
});

describe('optimistic row patches', () => {
  it('shows a started or stopped torrent in the state qBittorrent will report', () => {
    expect(OPTIMISTIC_ROW_PATCHES.start(torrent()).state).toBe('downloading');
    expect(OPTIMISTIC_ROW_PATCHES.start(torrent({ progress: 1 })).state).toBe('uploading');
    expect(OPTIMISTIC_ROW_PATCHES.forceStart(torrent({ progress: 1 })).state).toBe('forcedUP');
    expect(OPTIMISTIC_ROW_PATCHES.stop(torrent({ dlspeed: 9, upspeed: 3 }))).toEqual(expect.objectContaining({ state: 'stoppedDL', dlspeed: 0, upspeed: 0 }));
    expect(OPTIMISTIC_ROW_PATCHES.pause(torrent({ progress: 1 })).state).toBe('pausedUP');
    expect(OPTIMISTIC_ROW_PATCHES.setCategory(torrent(), { category: 'tv' }).category).toBe('tv');
    expect(OPTIMISTIC_ROW_PATCHES.setCategory(torrent({ category: 'tv' })).category).toBe('');
  });

  it('guards the field each patch changes', () => {
    expect(Object.keys(OPTIMISTIC_OVERRIDE_FIELD).sort()).toEqual(Object.keys(OPTIMISTIC_ROW_PATCHES).sort());
    expect(OPTIMISTIC_OVERRIDE_FIELD.setCategory).toBe('category');
    expect(OPTIMISTIC_OVERRIDE_FIELD.stop).toBe('state');
  });
});
