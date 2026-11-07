import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  claimEpisodes: vi.fn(),
  historyFindFirst: vi.fn(async (): Promise<{ id: string } | null> => null),
  notify: vi.fn(async () => 1),
  noteJobFailure: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    watchlistItem: { findMany: mocks.findMany, updateMany: mocks.updateMany },
    announcedEpisode: { createManyAndReturn: mocks.claimEpisodes },
    notificationHistory: { findFirst: mocks.historyFindFirst },
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('@/lib/polling-job-report', () => ({ noteJobFailure: mocks.noteJobFailure }));
vi.mock('./shared', () => ({ notifyAndLog: mocks.notify }));

import type { HistoryItem } from '@/types';
import { movieArrivals, notifyWatchlistArrivals, seriesArrivals, type LibraryArrival } from './watchlist-available';

const member = { id: 'u-member', role: 'member', status: 'active', template: 'member', permissions: {} };
const admin = { id: 'u-admin', role: 'admin', status: 'active', template: 'admin', permissions: {} };

function watchlistRow(overrides: Record<string, unknown> = {}) {
  return { id: 'w1', source: 'TMDB', externalId: '438631', mediaType: 'movie', title: 'Dune', user: member, ...overrides };
}

function history(overrides: Partial<HistoryItem>): HistoryItem {
  return {
    id: 1,
    sourceTitle: 'Dune.2021.1080p',
    quality: { quality: { name: 'Bluray-1080p' } },
    qualityCutoffNotMet: false,
    date: '2026-11-07T10:00:00Z',
    eventType: 'downloadFolderImported',
    data: {},
    ...overrides,
  } as HistoryItem;
}

const dune: LibraryArrival = { kind: 'movie', instanceId: 'radarr-main', arrId: 12, soleInstance: false, title: 'Dune', tmdbId: 438631 };
const severance: LibraryArrival = {
  kind: 'series', instanceId: 'sonarr-main', arrId: 7, soleInstance: false, title: 'Severance', tvdbId: 371980, episodes: ['S02E01'],
};

type NotifyCall = [Record<string, unknown> & { metadata: Record<string, unknown> }, unknown];
const calls = () => mocks.notify.mock.calls as unknown as NotifyCall[];

// The marker is a real claim: a second claim of the same item gets no rows.
let marked: Set<string>;
beforeEach(() => {
  vi.clearAllMocks();
  marked = new Set();
  mocks.findMany.mockResolvedValue([]);
  mocks.historyFindFirst.mockResolvedValue(null);
  mocks.updateMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) => {
    const fresh = where.id.in.filter((id) => !marked.has(id));
    fresh.forEach((id) => marked.add(id));
    return { count: fresh.length };
  });
  mocks.claimEpisodes.mockImplementation(async ({ data }: { data: Array<{ episodeKey: string }> }) => data.map((row) => ({ episodeKey: row.episodeKey })));
});

describe('which imports count as an arrival', () => {
  const movie = { id: 12, title: 'Dune', tmdbId: 438631 } as HistoryItem['movie'];

  it('takes each imported movie once, with its TMDB id', () => {
    const records = [
      history({ id: 1, movieId: 12, movie }),
      history({ id: 2, movieId: 12, movie, eventType: 'movieFileImported' }),
      history({ id: 3, movieId: 13, eventType: 'grabbed', movie: { id: 13, title: 'Other', tmdbId: 1 } as HistoryItem['movie'] }),
    ];
    expect(movieArrivals(records, records, 'radarr-main', false)).toEqual([dune]);
  });

  it('skips an upgrade: the old file was deleted for it in the same second', () => {
    const imported = history({ id: 2, movieId: 12, movie, date: '2026-11-03T13:19:01Z' });
    const deleted = history({ id: 1, movieId: 12, movie, eventType: 'movieFileDeleted', data: { reason: 'Upgrade' }, date: '2026-11-03T13:19:01Z' });
    expect(movieArrivals([imported, deleted], [imported, deleted], 'radarr-main', true)).toEqual([]);
    // The deletion was already read by the previous poll; it is still on the page this poll fetched.
    expect(movieArrivals([imported], [imported, deleted], 'radarr-main', true)).toEqual([]);
  });

  it('still counts an import after a manual delete, or an old upgrade long before', () => {
    const imported = history({ id: 3, movieId: 12, movie, date: '2026-11-03T13:19:01Z' });
    const manual = history({ id: 2, movieId: 12, eventType: 'movieFileDeleted', data: { reason: 'Manual' }, date: '2026-11-03T13:19:00Z' });
    const oldUpgrade = history({ id: 1, movieId: 12, eventType: 'movieFileDeleted', data: { reason: 'Upgrade' }, date: '2026-10-01T00:00:00Z' });
    expect(movieArrivals([imported], [imported, manual, oldUpgrade], 'radarr-main', true)).toHaveLength(1);
  });

  it('groups a season pack into one series arrival, leaving out upgraded episodes', () => {
    const series = { id: 7, title: 'Severance', tvdbId: 371980, tmdbId: 95396 } as HistoryItem['series'];
    const episode = (id: number, n: number) => ({ id, seasonNumber: 2, episodeNumber: n }) as HistoryItem['episode'];
    const records = [
      history({ id: 1, seriesId: 7, episodeId: 70, series, episode: episode(70, 1) }),
      history({ id: 2, seriesId: 7, episodeId: 71, series, episode: episode(71, 2), eventType: 'episodeFileImported' }),
      history({ id: 3, seriesId: 7, episodeId: 72, series, episode: episode(72, 3) }),
      history({ id: 4, seriesId: 7, episodeId: 72, series, eventType: 'episodeFileDeleted', data: { reason: 'Upgrade' } }),
    ];
    expect(seriesArrivals(records, records, 'sonarr-main', false)).toEqual([{
      kind: 'series', instanceId: 'sonarr-main', arrId: 7, soleInstance: false, title: 'Severance', tvdbId: 371980, tmdbId: 95396,
      episodes: ['S02E01', 'S02E02'],
      episodeRefs: [
        { episodeId: 70, seasonNumber: 2, episodeNumber: 1, label: 'S02E01' },
        { episodeId: 71, seasonNumber: 2, episodeNumber: 2, label: 'S02E02' },
      ],
    }]);
  });
});

describe('alerting the people who have it on their watchlist', () => {
  it('sends the owner their own copy that opens the watchlist focus link (the iOS fallback)', async () => {
    mocks.findMany.mockResolvedValue([watchlistRow()]);
    await notifyWatchlistArrivals([dune]);

    expect(mocks.findMany.mock.calls[0][0].where).toMatchObject({ availableNotifiedAt: null });
    expect(calls()).toHaveLength(1);
    const [event] = calls()[0];
    expect(event).toMatchObject({
      eventType: 'watchlistAvailable',
      title: 'Now in your library: Dune',
      body: 'From your watchlist: ready to watch.',
      url: '/watchlist?focus=w1',
      dedupeKey: 'movie-tmdb-438631-u-member',
      userIds: ['u-member'],
      ownerUserId: 'u-member',
    });
    expect(event.metadata).toMatchObject({ redirect: '/watchlist?focus=w1', watchlistItemId: 'w1', movieId: 12, instanceId: 'radarr-main' });
  });

  it('matches a series by TVDB id and names the episode', async () => {
    mocks.findMany.mockResolvedValue([watchlistRow({ id: 'w2', source: 'TVDB', externalId: '371980', mediaType: 'series', title: 'Severance' })]);
    await notifyWatchlistArrivals([severance]);
    expect(calls()[0][0]).toMatchObject({ url: '/watchlist?focus=w2', body: 'From your watchlist: S02E01 is ready to watch.' });
    // Claimed under the key "New episode" alerts use, so they never announce S02E01 again.
    expect(mocks.claimEpisodes).toHaveBeenCalledWith(expect.objectContaining({
      data: [{ userId: 'u-member', episodeKey: 'series-tvdb-371980:S02E01' }],
      skipDuplicates: true,
    }));
  });

  it('stays quiet when a "New episode" alert already announced every episode, and gives the item back', async () => {
    mocks.findMany.mockResolvedValue([watchlistRow({ id: 'w2', source: 'TVDB', externalId: '371980', mediaType: 'series', title: 'Severance' })]);
    mocks.claimEpisodes.mockResolvedValue([]);
    await notifyWatchlistArrivals([severance]);
    expect(mocks.notify).not.toHaveBeenCalled();
    // Released only where this run's own claim stands.
    const [, release] = mocks.updateMany.mock.calls;
    expect(release[0]).toEqual({
      where: { id: { in: ['w2'] }, availableNotifiedAt: mocks.updateMany.mock.calls[0][0].data.availableNotifiedAt },
      data: { availableNotifiedAt: null },
    });
  });

  it('claims no episodes when this title was already alerted to the person, so "New episode" still sends them', async () => {
    mocks.findMany.mockResolvedValue([watchlistRow({ id: 'w2', source: 'TVDB', externalId: '371980', mediaType: 'series', title: 'Severance' })]);
    mocks.historyFindFirst.mockResolvedValue({ id: 'h1' });
    await notifyWatchlistArrivals([severance]);
    expect(mocks.historyFindFirst).toHaveBeenCalledWith({
      where: { eventType: 'watchlistAvailable', dedupeKey: 'series-tvdb-371980-u-member' },
      select: { id: true },
    });
    expect(mocks.claimEpisodes).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('gives the item back when the episode claim fails', async () => {
    mocks.findMany.mockResolvedValue([watchlistRow({ id: 'w2', source: 'TVDB', externalId: '371980', mediaType: 'series', title: 'Severance' })]);
    mocks.claimEpisodes.mockRejectedValue(new Error('db down'));
    await expect(notifyWatchlistArrivals([severance])).resolves.toBeUndefined();
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.updateMany).toHaveBeenCalledTimes(2);
    expect(mocks.noteJobFailure).toHaveBeenCalled();
  });

  it('lists only the episodes not announced yet', async () => {
    mocks.findMany.mockResolvedValue([watchlistRow({ id: 'w2', source: 'TVDB', externalId: '371980', mediaType: 'series', title: 'Severance' })]);
    mocks.claimEpisodes.mockResolvedValue([{ episodeKey: 'series-tvdb-371980:S02E02' }]);
    await notifyWatchlistArrivals([{ ...severance, episodes: ['S02E01', 'S02E02'] }]);
    expect(calls()[0][0].body).toBe('From your watchlist: S02E02 is ready to watch.');
  });

  it('claims episodes in a fixed order, once each, so overlapping claims cannot deadlock', async () => {
    mocks.findMany.mockResolvedValue([watchlistRow({ id: 'w2', source: 'TVDB', externalId: '371980', mediaType: 'series', title: 'Severance' })]);
    await notifyWatchlistArrivals([{ ...severance, episodes: ['S02E03', 'S02E01', 'S02E03'] }]);
    expect(mocks.claimEpisodes.mock.calls[0][0].data.map((r: { episodeKey: string }) => r.episodeKey)).toEqual([
      'series-tvdb-371980:S02E01', 'series-tvdb-371980:S02E03',
    ]);
  });

  it('claims no episodes for a movie', async () => {
    mocks.findMany.mockResolvedValue([watchlistRow()]);
    await notifyWatchlistArrivals([dune]);
    expect(mocks.claimEpisodes).not.toHaveBeenCalled();
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });

  it('with several instances, matches a library-id item only when the title matches too', async () => {
    mocks.findMany.mockResolvedValue([
      watchlistRow({ id: 'w3', source: 'RADARR', externalId: '12', title: 'Arrival' }),
      watchlistRow({ id: 'w4', source: 'RADARR', externalId: '12', title: 'dune', user: admin }),
    ]);
    await notifyWatchlistArrivals([dune]);
    expect(calls().map(([e]) => e.userIds)).toEqual([['u-admin']]);
  });

  it('with one instance, trusts the library id even if the saved title is out of date', async () => {
    mocks.findMany.mockResolvedValue([watchlistRow({ source: 'RADARR', externalId: '12', title: 'Untitled Dune Project' })]);
    await notifyWatchlistArrivals([{ ...dune, soleInstance: true }]);
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });

  it('never matches a movie item to a series import, or another id', async () => {
    mocks.findMany.mockResolvedValue([watchlistRow({ mediaType: 'series' }), watchlistRow({ externalId: '1' })]);
    await notifyWatchlistArrivals([dune]);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('sends one alert per person even when they saved the title twice, and marks both', async () => {
    mocks.findMany.mockResolvedValue([watchlistRow(), watchlistRow({ id: 'w5', source: 'RADARR', externalId: '12' })]);
    await notifyWatchlistArrivals([dune]);
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['w1', 'w5'] }, availableNotifiedAt: null },
      data: { availableNotifiedAt: expect.any(Date) },
    });
  });

  it('sends once when two instances import the same title: the second finds it already claimed', async () => {
    mocks.findMany.mockResolvedValue([watchlistRow()]);
    await Promise.all([
      notifyWatchlistArrivals([dune]),
      notifyWatchlistArrivals([{ ...dune, instanceId: 'radarr-4k', arrId: 3 }]),
    ]);
    expect(mocks.updateMany).toHaveBeenCalledTimes(2);
    expect(mocks.notify).toHaveBeenCalledTimes(1);
  });

  it('gives a copy claimed by each instance the same dedupe key, so the history insert lets one through', async () => {
    // Main matches both saved copies; the 4K instance's library id 3 only matches the TMDB one.
    mocks.findMany.mockResolvedValueOnce([watchlistRow({ id: 'wR', source: 'RADARR', externalId: '12' })]);
    mocks.findMany.mockResolvedValueOnce([watchlistRow({ id: 'wT' })]);
    await notifyWatchlistArrivals([dune]);
    await notifyWatchlistArrivals([{ ...dune, instanceId: 'radarr-4k', arrId: 3 }]);
    expect(calls().map(([e]) => e.dedupeKey)).toEqual(['movie-tmdb-438631-u-member', 'movie-tmdb-438631-u-member']);
  });

  it('skips a member who may not view movies, or the watchlist, or get watchlist alerts, and marks nothing', async () => {
    for (const cap of ['movies.view', 'watchlist.view', 'notify.watchlist']) {
      mocks.findMany.mockResolvedValue([watchlistRow({ user: { ...member, permissions: { [cap]: false } } })]);
      await notifyWatchlistArrivals([dune]);
    }
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('skips a member who may not view series for a series import', async () => {
    mocks.findMany.mockResolvedValue([watchlistRow({ source: 'TVDB', externalId: '371980', mediaType: 'series', user: { ...member, permissions: { 'series.view': false } } })]);
    await notifyWatchlistArrivals([severance]);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('skips a disabled account', async () => {
    mocks.findMany.mockResolvedValue([watchlistRow({ user: { ...member, status: 'disabled' } })]);
    await notifyWatchlistArrivals([dune]);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('leaves out the Remove button for someone who may not edit their watchlist', async () => {
    mocks.findMany.mockResolvedValue([watchlistRow({ user: { ...member, permissions: { 'watchlist.edit': false } } })]);
    await notifyWatchlistArrivals([dune]);
    expect(calls()[0][0].metadata).not.toHaveProperty('watchlistItemId');
    expect(calls()[0][0].url).toBe('/watchlist?focus=w1');
  });

  it('does not query anything when nothing arrived', async () => {
    await notifyWatchlistArrivals([]);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it('never throws, so the poller still saves its history cursor', async () => {
    mocks.findMany.mockRejectedValue(new Error('db down'));
    await expect(notifyWatchlistArrivals([dune])).resolves.toBeUndefined();
    mocks.findMany.mockResolvedValue([watchlistRow()]);
    mocks.updateMany.mockRejectedValue(new Error('db down'));
    await expect(notifyWatchlistArrivals([dune])).resolves.toBeUndefined();
    expect(mocks.noteJobFailure).toHaveBeenCalledTimes(2);
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
