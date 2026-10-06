import { describe, expect, it, vi } from 'vitest';
import type { HistoryItem, QBittorrentTorrent, QueueItem } from '@/types';
import {
  activeHours, collectStatusMessages, createImportConfirmer, inCompletionRange,
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

type HistoryRow = Partial<HistoryItem>;

function arrClient(history: HistoryRow[] | Error, queue: Array<Partial<QueueItem>> | Error = []) {
  return {
    getQueue: queue instanceof Error ? vi.fn().mockRejectedValue(queue) : vi.fn().mockResolvedValue({ records: queue, totalRecords: queue.length }),
    getHistory: history instanceof Error
      ? vi.fn().mockRejectedValue(history)
      : vi.fn(async (page: number, pageSize: number) => ({ records: history.slice((page - 1) * pageSize, page * pageSize), totalRecords: history.length })),
  };
}

const confirmWith = (client: ReturnType<typeof arrClient>, addedOn?: number) =>
  createImportConfirmer({ sonarr: [client] as never, radarr: [] })('abc', addedOn);

const grabbed = (episodeId: number, date = '2026-10-05T14:00:57Z'): HistoryRow => ({ eventType: 'grabbed', date, episodeId });
const imported = (episodeId: number, date = '2026-10-05T14:08:02Z'): HistoryRow => ({ eventType: 'downloadFolderImported', date, episodeId });
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

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
    await expect(createImportConfirmer({ sonarr: [], radarr: [] })('abc')).resolves.toEqual({ status: 'unreachable' });
    await expect(confirmWith(arrClient(new Error('offline')))).resolves.toEqual({ status: 'unreachable' });
    await expect(confirmWith(arrClient([]))).resolves.toEqual({ status: 'unconfirmed' });
    const client = arrClient([imported(1), grabbed(1)]);
    await expect(confirmWith(client)).resolves.toEqual({ status: 'imported', source: 'sonarr', eventType: 'downloadFolderImported' });
    expect(client.getHistory).toHaveBeenCalledWith(1, 1000, 'date', 'descending', { downloadId: 'ABC' });
  });

  it('rejects stale or unparseable import history for the current torrent grab', async () => {
    const addedOn = Date.parse('2026-01-01T12:00:00Z') / 1000;
    // The grab belongs to an earlier life of this hash; only the import's date is under test.
    const only = (date: string) => arrClient([imported(1, date), grabbed(1, '2019-06-01T00:00:00Z')]);
    await expect(confirmWith(only('2026-01-01T11:54:59Z'), addedOn)).resolves.toEqual({ status: 'unconfirmed' });
    await expect(confirmWith(only('2026-01-01T12:00:01Z'), addedOn)).resolves.toMatchObject({ status: 'imported' });
    await expect(confirmWith(only('not-a-date'), addedOn)).resolves.toEqual({ status: 'unconfirmed' });
    await expect(confirmWith(only('2020-01-01T00:00:00Z'))).resolves.toMatchObject({ status: 'imported' });
  });

  // Sonarr's real history for hash 206A85E7… on 2026-10-05: a ten-episode
  // season pack of which only S01E01 imported. Helprr deleted the torrent and
  // the nine episodes still waiting on a manual import.
  it('does not treat a partially imported season pack as imported', async () => {
    const addedOn = Date.parse('2026-10-05T14:00:57Z') / 1000;
    const pack = range(11267, 11276);
    const partial = [imported(11267), ...pack.map((id) => grabbed(id))];
    await expect(confirmWith(arrClient(partial), addedOn)).resolves.toEqual({ status: 'unconfirmed' });
    const complete = [...pack.map((id) => imported(id)), ...pack.map((id) => grabbed(id))];
    await expect(confirmWith(arrClient(complete), addedOn)).resolves.toMatchObject({ status: 'imported' });
  });

  it('requires the import to be the newest event of every grabbed episode', async () => {
    const regrabbed = [grabbed(1, '2026-10-06T00:00:00Z'), imported(1, '2026-10-05T14:08:02Z'), grabbed(1, '2026-10-05T14:00:57Z')];
    await expect(confirmWith(arrClient(regrabbed))).resolves.toEqual({ status: 'unconfirmed' });
    // A stale import of one grabbed episode blocks the pack even when another is current.
    const addedOn = Date.parse('2026-10-05T14:00:57Z') / 1000;
    const stale = [imported(2), imported(1, '2026-04-24T04:34:00Z'), grabbed(2), grabbed(1)];
    await expect(confirmWith(arrClient(stale), addedOn)).resolves.toEqual({ status: 'unconfirmed' });
  });

  it('treats a newer failed or ignored event as unfinished', async () => {
    // Dismissed from the arr queue without removing it from the client: Sonarr writes downloadIgnored rows.
    const ignored = (episodeId: number): HistoryRow => ({ eventType: 'downloadIgnored', date: '2026-10-05T15:00:00Z', episodeId });
    await expect(confirmWith(arrClient([ignored(1), ignored(2), imported(1), grabbed(1), grabbed(2)]))).resolves.toEqual({ status: 'unconfirmed' });
    await expect(confirmWith(arrClient([{ eventType: 'downloadFailed', date: '2026-10-05T15:00:00Z', episodeId: 1 }, imported(1), grabbed(1)]))).resolves.toEqual({ status: 'unconfirmed' });
    // Rows that carry no episode id cannot be accounted, so they hold the download back too.
    await expect(confirmWith(arrClient([imported(1), { eventType: 'grabbed', date: '2026-10-05T14:00:57Z' }]))).resolves.toEqual({ status: 'unconfirmed' });
  });

  it('accounts Radarr history by movie', async () => {
    const radarr = arrClient([{ eventType: 'downloadFolderImported', date: '2026-10-05T14:08:02Z', movieId: 7 }, { eventType: 'grabbed', date: '2026-10-05T14:00:57Z', movieId: 7 }]);
    await expect(createImportConfirmer({ sonarr: [], radarr: [radarr] as never })('abc')).resolves.toEqual({ status: 'imported', source: 'radarr', eventType: 'downloadFolderImported' });
    const pending = arrClient([{ eventType: 'grabbed', date: '2026-10-05T14:00:57Z', movieId: 7 }]);
    await expect(createImportConfirmer({ sonarr: [], radarr: [pending] as never })('abc')).resolves.toEqual({ status: 'unconfirmed' });
  });

  it('withholds confirmation while any arr queue still lists the download', async () => {
    const complete = [imported(1), grabbed(1)];
    const blocked = arrClient(complete, [queueItem({ downloadId: 'ABC', trackedDownloadState: 'importBlocked' })]);
    await expect(confirmWith(blocked)).resolves.toEqual({ status: 'unconfirmed' });
    expect(blocked.getHistory).not.toHaveBeenCalled();
    const finished = arrClient(complete, [queueItem({ downloadId: 'ABC', trackedDownloadState: 'imported' }), queueItem({ downloadId: 'OTHER', trackedDownloadState: 'downloading' })]);
    await expect(confirmWith(finished)).resolves.toMatchObject({ status: 'imported' });
    // Another instance still working on the same hash blocks it too.
    const otherInstance = arrClient([], [queueItem({ downloadId: 'abc', trackedDownloadState: 'importPending' })]);
    await expect(createImportConfirmer({ sonarr: [arrClient(complete)] as never, radarr: [otherInstance] as never })('ABC')).resolves.toEqual({ status: 'unconfirmed' });
  });

  it('never confirms a download no arr grabbed', async () => {
    // Added by hand into the arr's category: with no grabs, history cannot say
    // what the torrent should have delivered, and an empty queue proves nothing.
    await expect(confirmWith(arrClient([imported(1)]))).resolves.toEqual({ status: 'unconfirmed' });
    await expect(confirmWith(arrClient(range(1, 10).map((id) => imported(id))))).resolves.toEqual({ status: 'unconfirmed' });
    await expect(confirmWith(arrClient([{ eventType: 'downloadIgnored', date: '2026-10-05T15:00:00Z', episodeId: 2 }, imported(1)]))).resolves.toEqual({ status: 'unconfirmed' });
  });

  it('lets any arr that grabbed the torrent veto another arr\'s confirmation', async () => {
    const addedOn = Date.parse('2026-10-05T14:00:57Z') / 1000;
    const pair = (other: ReturnType<typeof arrClient>) =>
      createImportConfirmer({ sonarr: [arrClient([imported(1), grabbed(1)]), other] as never, radarr: [] })('abc', addedOn);
    // Same hash, second instance grabbed the whole pack and imported one episode.
    await expect(pair(arrClient([imported(1), ...range(1, 10).map((id) => grabbed(id))]))).resolves.toEqual({ status: 'unconfirmed' });
    // Its grabs of an earlier torrent with this hash say nothing about the current one.
    const earlier = [imported(1, '2026-04-24T04:34:00Z'), ...range(1, 10).map((id) => grabbed(id, '2026-04-24T04:00:00Z'))];
    await expect(pair(arrClient(earlier))).resolves.toMatchObject({ status: 'imported' });
  });

  it('withholds confirmation when any configured arr cannot be read completely', async () => {
    const complete = [imported(1), grabbed(1)];
    const beside = (other: ReturnType<typeof arrClient>) =>
      createImportConfirmer({ sonarr: [other, arrClient(complete)] as never, radarr: [] })('abc');
    await expect(confirmWith(arrClient(complete, new Error('queue offline')))).resolves.toEqual({ status: 'unreachable' });
    // A healthy arr with a complete import cannot speak for one that is unreadable.
    await expect(beside(arrClient([], new Error('queue offline')))).resolves.toEqual({ status: 'unreachable' });
    await expect(beside(arrClient(new Error('history offline')))).resolves.toEqual({ status: 'unreachable' });
    // The arr reported eleven rows and delivered one: the grabs are missing, not absent.
    const truncated = arrClient([]);
    truncated.getHistory.mockResolvedValue({ records: [imported(1)], totalRecords: 11 });
    await expect(confirmWith(truncated)).resolves.toEqual({ status: 'unreachable' });
    const endless = arrClient(complete);
    endless.getHistory.mockImplementation(async () => ({ records: Array.from({ length: 1000 }, () => imported(1)), totalRecords: 1_000_000 }));
    await expect(confirmWith(endless)).resolves.toEqual({ status: 'unreachable' });
  });

  it('reports a download an arr positively lists as unfinished even beside an outage', async () => {
    const down = () => arrClient(new Error('history offline'), new Error('queue offline'));
    const listed = arrClient([], [queueItem({ downloadId: 'ABC', trackedDownloadState: 'importBlocked' })]);
    await expect(createImportConfirmer({ sonarr: [down(), listed] as never, radarr: [] })('abc')).resolves.toEqual({ status: 'unconfirmed' });
    const historyDown = arrClient(new Error('history offline'));
    const pending = arrClient([grabbed(1)]);
    await expect(createImportConfirmer({ sonarr: [historyDown, pending] as never, radarr: [] })('abc')).resolves.toEqual({ status: 'unconfirmed' });
  });

  it('reads history past the first page before accounting', async () => {
    // Newest first: 599 imports, then 600 grabs. Page one alone (599 imports +
    // grabs 1-401) looks complete; episode 600 on page two was never imported.
    const partial = [...range(1, 599).map((id) => imported(id)), ...range(1, 600).map((id) => grabbed(id))];
    const client = arrClient(partial);
    await expect(confirmWith(client)).resolves.toEqual({ status: 'unconfirmed' });
    expect(client.getHistory).toHaveBeenCalledTimes(2);
    const complete = [...range(1, 600).map((id) => imported(id)), ...range(1, 600).map((id) => grabbed(id))];
    await expect(confirmWith(arrClient(complete))).resolves.toMatchObject({ status: 'imported' });
  });

  it('reads each arr queue once per confirmer', async () => {
    const client = arrClient([imported(1), grabbed(1)]);
    const confirm = createImportConfirmer({ sonarr: [client] as never, radarr: [] });
    await Promise.all([confirm('abc'), confirm('def'), confirm('abc')]);
    expect(client.getQueue).toHaveBeenCalledTimes(1);
    expect(client.getHistory).toHaveBeenCalledTimes(3);
  });
});
