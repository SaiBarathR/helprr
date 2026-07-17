import { describe, expect, it, vi } from 'vitest';
import type { QBittorrentTorrent, QueueItem } from '@/types';
import {
  activeHours, collectStatusMessages, confirmImportedViaHistory, inCompletionRange,
  batchFetchTrackerDomains, isTorrentPrivate, matchesIgnoredPatterns, matchesPatterns,
  matchesPrivacy, matchesTrackerDomain, progressedEnough, seedingHours, shortHash,
  trackerHostFromUrl,
} from '@/lib/cleanup/helpers';

function torrent(overrides: Partial<QBittorrentTorrent> = {}): QBittorrentTorrent {
  return { hash: 'ABCDEF1234', name: 'Torrent', size: 1, progress: 0, dlspeed: 0, upspeed: 0, num_seeds: 0, num_leechs: 0, state: 'downloading', eta: 0, category: '', tags: '', priority: 0, added_on: 0, completion_on: 0, save_path: '', amount_left: 0, completed: 0, downloaded: 0, uploaded: 0, downloaded_session: 0, uploaded_session: 0, dl_limit: 0, up_limit: 0, magnet_uri: '', time_active: 0, seeding_time: 0, availability: 0, ratio: 0, seq_dl: false, f_l_piece_prio: false, force_start: false, auto_tmm: false, max_ratio: -1, max_seeding_time: -1, ...overrides };
}

function queueItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return { id: 1, downloadId: 'ABC', title: 'Title', status: '', trackedDownloadStatus: '', trackedDownloadState: '', statusMessages: [], errorMessage: '', timeleft: '', estimatedCompletionTime: '', size: 0, sizeleft: 0, protocol: '', downloadClient: '', indexer: '', outputPath: '', downloadForced: false, ...overrides };
}

describe('cleanup helpers', () => {
  it('uses asymmetric completion boundaries', () => {
    expect(inCompletionRange(0, { minCompletionPercentage: 0, maxCompletionPercentage: 40 })).toBe(true);
    expect(inCompletionRange(10, { minCompletionPercentage: 10, maxCompletionPercentage: 40 })).toBe(false);
    expect(inCompletionRange(10.1, { minCompletionPercentage: 10, maxCompletionPercentage: 40 })).toBe(true);
    expect(inCompletionRange(40, { minCompletionPercentage: 10, maxCompletionPercentage: 40 })).toBe(true);
    expect(inCompletionRange(40.1, { minCompletionPercentage: 10, maxCompletionPercentage: 40 })).toBe(false);
  });

  it('matches public, private, and both privacy modes', () => {
    expect(matchesPrivacy(torrent({ private: false }), 'public')).toBe(true);
    expect(matchesPrivacy(torrent({ private: true }), 'public')).toBe(false);
    expect(matchesPrivacy(torrent({ private: true }), 'private')).toBe(true);
    expect(matchesPrivacy(torrent({ private: undefined }), 'private')).toBe(false);
    expect(matchesPrivacy(torrent({ private: undefined }), 'public')).toBe(false);
    expect(matchesPrivacy(torrent({ private: true }), 'both')).toBe(true);
    expect(matchesPrivacy(torrent({ private: undefined }), 'both')).toBe(true);
  });

  it('matches included and excluded status patterns', () => {
    expect(matchesPatterns(['Title Mismatch'], [], 'include')).toBe(false);
    expect(matchesPatterns(['Title Mismatch'], ['title mismatch'], 'include')).toBe(true);
    expect(matchesPatterns(['anything'], [], 'exclude')).toBe(true);
    expect(matchesPatterns(['Title Mismatch'], ['MISMATCH'], 'exclude')).toBe(false);
  });

  it('matches ignored hashes, categories, tags, and tracker suffixes', () => {
    const t = torrent({ hash: 'ABC', category: 'Sonarr', tags: 'keep, other' });
    expect(matchesIgnoredPatterns(t, [], [])).toBe(false);
    expect(matchesIgnoredPatterns(t, [], ['abc'])).toBe(true);
    expect(matchesIgnoredPatterns(t, [], ['SONARR'])).toBe(true);
    expect(matchesIgnoredPatterns(t, [], ['KEEP'])).toBe(true);
    expect(matchesIgnoredPatterns(t, ['tracker.example.org'], ['tracker.example.org'])).toBe(true);
    expect(matchesIgnoredPatterns(t, ['sub.example.org'], ['.example.org'])).toBe(true);
    expect(matchesIgnoredPatterns(t, [], [' ', 'missing'])).toBe(false);
  });

  it('checks byte progress', () => {
    expect(progressedEnough(100, 100, null)).toBe(false);
    expect(progressedEnough(1, null, null)).toBe(true);
    expect(progressedEnough(199, 100, 100)).toBe(false);
    expect(progressedEnough(200, 100, 100)).toBe(true);
  });

  it('calculates active and seeding hours', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
    expect(activeHours(torrent({ time_active: 7200 }))).toBe(2);
    expect(activeHours(torrent({ time_active: 0, added_on: Date.now() / 1000 - 3600 }))).toBe(0);
    const withoutTimeActive = { ...torrent({ added_on: Date.now() / 1000 - 3600 }) } as Record<string, unknown>;
    delete withoutTimeActive.time_active;
    expect(activeHours(withoutTimeActive as unknown as QBittorrentTorrent)).toBe(1);
    expect(activeHours(torrent({ added_on: 0 }))).toBe(0);
    expect(seedingHours(torrent({ seeding_time: 7200, completion_on: Date.now() / 1000 - 48 * 3600 }))).toBe(2);
    const withoutSeedingTime = { ...torrent({ completion_on: Date.now() / 1000 - 48 * 3600 }) } as Record<string, unknown>;
    delete withoutSeedingTime.seeding_time;
    expect(seedingHours(withoutSeedingTime as unknown as QBittorrentTorrent)).toBe(48);
    expect(seedingHours(torrent({ seeding_time: 0, completion_on: 0 }))).toBe(0);
    vi.useRealTimers();
  });

  it('collects queue status messages', () => {
    expect(collectStatusMessages(queueItem({ errorMessage: 'error', statusMessages: [{ title: 'title', messages: ['nested'] }] }))).toEqual(['error', 'title', 'nested']);
  });

  it('formats hashes and tracker hosts', () => {
    expect(shortHash('ABCDEF1234')).toBe('abcdef12');
    expect(trackerHostFromUrl('HTTPS://Tracker.Example.Org/announce')).toBe('tracker.example.org');
    expect(trackerHostFromUrl('garbage')).toBeNull();
  });

  it('matches tracker domains only at hostname boundaries', () => {
    expect(matchesTrackerDomain('example.org', 'example.org')).toBe(true);
    expect(matchesTrackerDomain('tracker.example.org', 'example.org')).toBe(true);
    expect(matchesTrackerDomain('notexample.org', 'example.org')).toBe(false);
    expect(matchesTrackerDomain('tracker.example.org', '.example.org')).toBe(true);
    expect(matchesTrackerDomain('example.org', '')).toBe(false);
  });

  it('preserves failed tracker lookups as unknown', async () => {
    const qbit = { getTorrentTrackers: vi.fn().mockResolvedValueOnce([{ url: 'https://tracker.example.org/announce' }]).mockRejectedValueOnce(new Error('offline')) };
    const domains = await batchFetchTrackerDomains(qbit as never, [torrent({ hash: 'OK' }), torrent({ hash: 'FAIL' })], 1);
    expect(domains.get('ok')).toEqual(['tracker.example.org']);
    expect(domains.get('fail')).toBeNull();
  });

  it('reports torrent privacy as a tri-state value', () => {
    expect(isTorrentPrivate(torrent({ private: true }))).toBe(true);
    expect(isTorrentPrivate(torrent({ private: false }))).toBe(false);
    expect(isTorrentPrivate(torrent({ private: undefined }))).toBeNull();
  });

  it('distinguishes unreachable, unconfirmed, and imported Arr history', async () => {
    await expect(confirmImportedViaHistory('abc', { sonarr: [], radarr: [] })).resolves.toEqual({ status: 'unreachable' });
    const throwing = { getHistory: vi.fn().mockRejectedValue(new Error('offline')) };
    await expect(confirmImportedViaHistory('abc', { sonarr: [throwing] as never, radarr: [] })).resolves.toEqual({ status: 'unreachable' });
    const empty = { getHistory: vi.fn().mockResolvedValue({ records: [] }) };
    await expect(confirmImportedViaHistory('abc', { sonarr: [empty] as never, radarr: [] })).resolves.toEqual({ status: 'unconfirmed' });
    const imported = { getHistory: vi.fn().mockResolvedValue({ records: [{ eventType: 'downloadFolderImported', date: '2020-01-01T00:00:00Z' }] }) };
    await expect(confirmImportedViaHistory('abc', { sonarr: [imported] as never, radarr: [] })).resolves.toEqual({ status: 'imported', source: 'sonarr', eventType: 'downloadFolderImported' });
    expect(imported.getHistory).toHaveBeenCalledWith(1, 50, 'date', 'descending', { downloadId: 'ABC' });
  });

  it('rejects stale or unparseable import history for the current torrent grab', async () => {
    const addedOn = Date.parse('2026-01-01T12:00:00Z') / 1000;
    const client = { getHistory: vi.fn() };
    client.getHistory.mockResolvedValueOnce({ records: [{ eventType: 'downloadFolderImported', date: '2026-01-01T11:54:59Z' }] });
    await expect(confirmImportedViaHistory('abc', { sonarr: [client] as never, radarr: [] }, addedOn)).resolves.toEqual({ status: 'unconfirmed' });
    client.getHistory.mockResolvedValueOnce({ records: [{ eventType: 'downloadFolderImported', date: '2026-01-01T12:00:01Z' }] });
    await expect(confirmImportedViaHistory('abc', { sonarr: [client] as never, radarr: [] }, addedOn)).resolves.toMatchObject({ status: 'imported' });
    client.getHistory.mockResolvedValueOnce({ records: [{ eventType: 'downloadFolderImported', date: 'not-a-date' }] });
    await expect(confirmImportedViaHistory('abc', { sonarr: [client] as never, radarr: [] }, addedOn)).resolves.toEqual({ status: 'unconfirmed' });
    client.getHistory.mockResolvedValueOnce({ records: [{ eventType: 'downloadFolderImported', date: '2020-01-01T00:00:00Z' }] });
    await expect(confirmImportedViaHistory('abc', { sonarr: [client] as never, radarr: [] })).resolves.toMatchObject({ status: 'imported' });
  });
});
