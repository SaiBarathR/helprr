import { beforeEach, describe, expect, it, vi } from 'vitest';

// "New episode" alerts for shows someone played in Jellyfin. Jellyfin, the
// database and the sender are mocked: nothing is sent and Jellyfin is only read.
const mocks = vi.hoisted(() => ({
  findUsers: vi.fn(),
  claim: vi.fn(),
  notify: vi.fn(async () => 1),
  noteJobFailure: vi.fn(),
  warn: vi.fn(),
  userContext: vi.fn(),
  cacheReads: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: { user: { findMany: mocks.findUsers }, announcedEpisode: { createManyAndReturn: mocks.claim } },
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: mocks.warn } }));
vi.mock('@/lib/polling-job-report', () => ({ noteJobFailure: mocks.noteJobFailure }));
vi.mock('./shared', () => ({ notifyAndLog: mocks.notify }));
vi.mock('@/lib/service-helpers', async () => {
  class JellyfinNotLinkedError extends Error {}
  return {
    JellyfinNotLinkedError,
    getJellyfinUserContext: mocks.userContext,
    isJellyfinUnavailable: (error: unknown) => error instanceof JellyfinNotLinkedError,
  };
});
// A per-seed cache, like the real one within its TTL.
vi.mock('@/lib/cache/jellyfin-watch-status-cache', () => {
  const store = new Map<string, unknown>();
  return {
    getWatchStatusJson: async (seed: string, fetcher: () => Promise<unknown>) => {
      mocks.cacheReads(seed);
      if (!store.has(seed)) store.set(seed, await fetcher());
      return store.get(seed);
    },
    clear: () => store.clear(),
  };
});

import type { HistoryItem } from '@/types';
import * as cache from '@/lib/cache/jellyfin-watch-status-cache';
import { JellyfinNotLinkedError } from '@/lib/service-helpers';
import { seriesArrivals, type LibraryArrival } from './watchlist-available';
import { fetchPlayedSeries, isSameSeries, notifyWatchingEpisodes, playedWithin, WATCHING_BATCH_BUDGET_MS } from './watching-episodes';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-07T12:00:00Z');

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u-ana', role: 'member', status: 'active', template: 'member', permissions: {},
    jellyfinUserId: 'jf-ana', settings: null, ...overrides,
  };
}

/** A Jellyfin client whose user played these series (Jellyfin ids → provider ids + last play). */
function jellyfin(plays: Array<{ seriesId: string; tvdb?: string; tmdb?: string; daysAgo: number }>) {
  const episodes = [
    ...plays
      .map((p, i) => ({ Id: `ep-${i}`, SeriesId: p.seriesId, UserData: { LastPlayedDate: new Date(NOW - p.daysAgo * DAY).toISOString() } }))
      .sort((a, b) => Date.parse(b.UserData.LastPlayedDate) - Date.parse(a.UserData.LastPlayedDate)),
    { Id: 'never-played', SeriesId: 'jf-other', UserData: { Played: false } },
  ];
  const queryItems = vi.fn(async (params: Record<string, unknown>) => {
    if (params.IncludeItemTypes === 'Episode') {
      const start = Number(params.StartIndex ?? 0);
      return { Items: episodes.slice(start, start + Number(params.Limit)) };
    }
    const ids = String(params.Ids).split(',');
    return {
      Items: plays.filter((p, i) => ids.includes(p.seriesId) && plays.findIndex((q) => q.seriesId === p.seriesId) === i).map((p) => ({
        Id: p.seriesId,
        ProviderIds: { ...(p.tvdb ? { Tvdb: p.tvdb } : {}), ...(p.tmdb ? { Tmdb: p.tmdb } : {}) },
      })),
    };
  });
  return { queryItems };
}

function arrival(overrides: Partial<LibraryArrival> = {}): LibraryArrival {
  return {
    kind: 'series', instanceId: 'sonarr-main', arrId: 7, soleInstance: true, title: 'Severance',
    tvdbId: 371980, tmdbId: 95396, episodes: ['S02E05'],
    episodeRefs: [{ episodeId: 75, seasonNumber: 2, episodeNumber: 5, label: 'S02E05', title: "Trojan's Horse" }],
    ...overrides,
  };
}

function refs(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    episodeId: 70 + i, seasonNumber: 2, episodeNumber: i + 1, label: `S02E0${i + 1}`,
  }));
}

type NotifyCall = [Record<string, unknown> & { metadata: Record<string, unknown> }, unknown];
const calls = () => mocks.notify.mock.calls as unknown as NotifyCall[];

// The AnnouncedEpisode table: an insert of a (person, episode) already there is skipped.
let claimed: Set<string>;
let client: ReturnType<typeof jellyfin>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  (cache as unknown as { clear: () => void }).clear();
  claimed = new Set();
  client = jellyfin([{ seriesId: 'jf-sev', tvdb: '371980', tmdb: '95396', daysAgo: 3 }]);
  mocks.findUsers.mockResolvedValue([user()]);
  mocks.claim.mockImplementation(async ({ data }: { data: Array<{ userId: string; episodeKey: string }> }) => {
    const fresh = data.filter((row) => !claimed.has(`${row.userId}|${row.episodeKey}`));
    fresh.forEach((row) => claimed.add(`${row.userId}|${row.episodeKey}`));
    return fresh.map((row) => ({ episodeKey: row.episodeKey }));
  });
  mocks.userContext.mockImplementation(async (u: { jellyfinUserId: string }) => ({
    client, connectionFingerprint: 'fp', jellyfinUserId: u.jellyfinUserId,
  }));
});

describe('mapping a Sonarr series to the Jellyfin one', () => {
  const played = { tvdbId: '371980', tmdbId: '95396', lastPlayed: NOW };

  it('matches by TVDB id', () => {
    expect(isSameSeries({ tvdbId: 371980 }, played)).toBe(true);
    expect(isSameSeries({ tvdbId: 1 }, played)).toBe(false);
  });

  it('falls back to TMDB when either side has no TVDB id', () => {
    expect(isSameSeries({ tmdbId: 95396 }, played)).toBe(true);
    expect(isSameSeries({ tvdbId: 371980, tmdbId: 95396 }, { tmdbId: '95396', lastPlayed: NOW })).toBe(true);
    expect(isSameSeries({ tmdbId: 1 }, played)).toBe(false);
  });

  it('does not let TMDB override two different TVDB ids', () => {
    expect(isSameSeries({ tvdbId: 1, tmdbId: 95396 }, played)).toBe(false);
  });
});

describe('the N-day window', () => {
  const played = [{ tvdbId: '371980', lastPlayed: NOW - 10 * DAY }];

  it('counts a show played within the window', () => {
    expect(playedWithin({ tvdbId: 371980 }, played, 14, NOW)).toBe(true);
    expect(playedWithin({ tvdbId: 371980 }, played, 7, NOW)).toBe(false);
  });

  it("uses the person's own window, default 14 days", async () => {
    client = jellyfin([{ seriesId: 'jf-sev', tvdb: '371980', daysAgo: 10 }]);
    mocks.findUsers.mockResolvedValue([
      user({ id: 'u-default' }),
      user({ id: 'u-week', jellyfinUserId: 'jf-week', settings: { watchingEpisodeDays: 7 } }),
      user({ id: 'u-month', jellyfinUserId: 'jf-month', settings: { watchingEpisodeDays: 30 } }),
    ]);
    await notifyWatchingEpisodes([arrival()], { groupingEnabled: true });
    expect(calls().map(([e]) => e.ownerUserId)).toEqual(['u-default', 'u-month']);
  });

  it('only asks for active people with a Jellyfin link who have not turned it off', async () => {
    await notifyWatchingEpisodes([arrival()], { groupingEnabled: true });
    expect(mocks.findUsers.mock.calls[0][0].where).toEqual({
      status: 'active',
      jellyfinUserId: { not: null },
      OR: [{ settings: { is: null } }, { settings: { is: { watchingEpisodeDays: { gt: 0 } } } }],
    });
  });
});

describe('sending', () => {
  it('sends the watcher their own copy that opens the episode', async () => {
    await notifyWatchingEpisodes([arrival()], { groupingEnabled: true });
    expect(calls()).toHaveLength(1);
    const [event] = calls()[0];
    expect(event).toMatchObject({
      eventType: 'watchingNewEpisode',
      title: "New episode: Severance S02E05 · Trojan's Horse",
      url: '/series/7/season/2/episode/75?instance=sonarr-main',
      userIds: ['u-ana'],
      ownerUserId: 'u-ana',
    });
    expect(event.metadata).toMatchObject({ episodeId: 75, seriesId: 7, instanceId: 'sonarr-main' });
    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({
      data: [{ userId: 'u-ana', episodeKey: 'series-tvdb-371980:S02E05' }],
      skipDuplicates: true,
    }));
  });

  it('leaves out people who did not play the show, or may not see series', async () => {
    mocks.findUsers.mockResolvedValue([
      user({ id: 'u-other', jellyfinUserId: 'jf-other' }),
      user({ id: 'u-noseries', jellyfinUserId: 'jf-noseries', permissions: { 'series.view': false } }),
      user({ id: 'u-nonotify', jellyfinUserId: 'jf-nonotify', permissions: { 'notify.watchlist': false } }),
    ]);
    mocks.userContext.mockImplementation(async (u: { jellyfinUserId: string }) => ({
      client: u.jellyfinUserId === 'jf-other' ? jellyfin([{ seriesId: 'jf-x', tvdb: '1', daysAgo: 1 }]) : client,
      connectionFingerprint: 'fp',
      jellyfinUserId: u.jellyfinUserId,
    }));
    await notifyWatchingEpisodes([arrival()], { groupingEnabled: true });
    expect(calls()).toHaveLength(0);
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it('groups a season pack into one push when grouping is on', async () => {
    const pack = arrival({ episodes: refs(5).map((r) => r.label), episodeRefs: refs(5) });
    await notifyWatchingEpisodes([pack], { groupingEnabled: true });
    expect(calls()).toHaveLength(1);
    const [event] = calls()[0];
    expect(event).toMatchObject({
      title: '5 new episodes: Severance',
      body: 'S02E01 · S02E02 · S02E03 · …and 2 more',
      url: '/series/7/season/2?instance=sonarr-main',
    });
    expect(event.metadata).toMatchObject({ grouped: true, groupCount: 5, seriesId: 7 });
  });

  it('groups episodes of several shows that land in one poll', async () => {
    client = jellyfin([
      { seriesId: 'jf-sev', tvdb: '371980', daysAgo: 1 },
      { seriesId: 'jf-bear', tvdb: '403294', daysAgo: 2 },
    ]);
    await notifyWatchingEpisodes([
      arrival({ episodeRefs: refs(2) }),
      arrival({ arrId: 9, title: 'The Bear', tvdbId: 403294, tmdbId: undefined, episodeRefs: [refs(1)[0]] }),
    ], { groupingEnabled: true });
    expect(calls()).toHaveLength(1);
    const [event] = calls()[0];
    expect(event).toMatchObject({
      title: '3 new episodes',
      body: 'Severance S02E01 · Severance S02E02 · The Bear S02E01',
      url: '/notifications',
    });
    expect(event.metadata.seriesId).toBeUndefined();
  });

  it('sends each episode on its own when grouping is off, or below the threshold', async () => {
    await notifyWatchingEpisodes([arrival({ episodeRefs: refs(3) })], { groupingEnabled: false });
    expect(calls()).toHaveLength(3);
    mocks.notify.mockClear();
    await notifyWatchingEpisodes([arrival({ arrId: 8, tvdbId: undefined, episodeRefs: refs(2) })], { groupingEnabled: true });
    expect(calls()).toHaveLength(2);
  });

  it("reads each person's plays once per batch", async () => {
    await notifyWatchingEpisodes([arrival(), arrival({ arrId: 8, tvdbId: 1, tmdbId: undefined })], { groupingEnabled: true });
    expect(mocks.cacheReads).toHaveBeenCalledTimes(1);
    expect(client.queryItems).toHaveBeenCalledTimes(2);
  });
});

describe('never twice', () => {
  it('skips episodes "Now in your library" already announced', async () => {
    // The key #654's alert claims for the same title and episode.
    claimed.add('u-ana|series-tvdb-371980:S02E05');
    await notifyWatchingEpisodes([arrival()], { groupingEnabled: true });
    expect(calls()).toHaveLength(0);
  });

  it('pushes once when two instances import the same episode at the same time', async () => {
    const fourK = arrival({ instanceId: 'sonarr-4k', arrId: 3, soleInstance: false });
    await Promise.all([
      notifyWatchingEpisodes([arrival({ soleInstance: false })], { groupingEnabled: true }),
      notifyWatchingEpisodes([fourK], { groupingEnabled: true }),
    ]);
    expect(calls()).toHaveLength(1);
  });

  it('does not repeat an episode later, even after the notification list was cleared', async () => {
    await notifyWatchingEpisodes([arrival()], { groupingEnabled: true });
    // Nothing is read from the notification history, so deleting it changes nothing.
    await notifyWatchingEpisodes([arrival({ instanceId: 'sonarr-4k', arrId: 3 })], { groupingEnabled: true });
    expect(calls()).toHaveLength(1);
  });

  it('sends only the episodes not yet announced', async () => {
    claimed.add('u-ana|series-tvdb-371980:S02E01');
    await notifyWatchingEpisodes([arrival({ episodeRefs: refs(2) })], { groupingEnabled: true });
    expect(calls().map(([e]) => e.metadata.episodeId)).toEqual([71]);
  });

  it('does not alert for a quality upgrade', async () => {
    const series = { id: 7, title: 'Severance', tvdbId: 371980 } as HistoryItem['series'];
    const base = { sourceTitle: 'x', quality: { quality: { name: 'WEBDL-2160p' } }, qualityCutoffNotMet: false, date: '2026-11-07T11:00:00Z', data: {} };
    const records = [
      { ...base, id: 2, eventType: 'downloadFolderImported', seriesId: 7, episodeId: 75, series, episode: { id: 75, seasonNumber: 2, episodeNumber: 5 } },
      { ...base, id: 1, eventType: 'episodeFileDeleted', seriesId: 7, episodeId: 75, series, data: { reason: 'Upgrade' } },
    ] as unknown as HistoryItem[];
    await notifyWatchingEpisodes(seriesArrivals(records, records, 'sonarr-main', true), { groupingEnabled: true });
    expect(mocks.findUsers).not.toHaveBeenCalled();
    expect(calls()).toHaveLength(0);
  });
});

describe('Jellyfin', () => {
  it("reads plays from Jellyfin's own play state, so the Playback Reporting plugin is not needed", async () => {
    client = jellyfin([
      { seriesId: 'jf-sev', tvdb: '371980', daysAgo: 3 },
      { seriesId: 'jf-sev', tvdb: '371980', daysAgo: 1 },
      { seriesId: 'jf-noids', daysAgo: 1 },
    ]);
    const played = await fetchPlayedSeries(client as never);
    expect(played).toEqual([{ tvdbId: '371980', lastPlayed: NOW - DAY }]);
    // Only the documented /Items catalog query, sorted by the person's last play.
    expect(client.queryItems.mock.calls[0][0]).toMatchObject({ IncludeItemTypes: 'Episode', SortBy: 'DatePlayed', SortOrder: 'Descending' });
    expect(client.queryItems.mock.calls[1][0]).toMatchObject({ Ids: 'jf-sev,jf-noids', Fields: 'ProviderIds' });
  });

  it('pages through a binge until plays are older than the longest window', async () => {
    client = jellyfin([
      ...Array.from({ length: 450 }, () => ({ seriesId: 'jf-kids', tvdb: '1', daysAgo: 1 })),
      { seriesId: 'jf-sev', tvdb: '371980', daysAgo: 20 },
      { seriesId: 'jf-old', tvdb: '2', daysAgo: 120 },
    ]);
    const played = await fetchPlayedSeries(client as never);
    expect(played.map((s) => s.tvdbId).sort()).toEqual(['1', '371980']);
    expect(client.queryItems.mock.calls.filter(([p]) => p.IncludeItemTypes === 'Episode').map(([p]) => p.StartIndex)).toEqual([0, 200, 400]);
  });

  it('skips a person whose Jellyfin account is not linked', async () => {
    mocks.userContext.mockRejectedValue(new JellyfinNotLinkedError());
    await notifyWatchingEpisodes([arrival()], { groupingEnabled: true });
    expect(calls()).toHaveLength(0);
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it('stops the batch after two people in a row get no answer, without failing the Sonarr poll', async () => {
    mocks.findUsers.mockResolvedValue([
      user({ id: 'u-1', jellyfinUserId: 'jf-1' }), user({ id: 'u-2', jellyfinUserId: 'jf-2' }), user(),
    ]);
    mocks.userContext.mockRejectedValue(Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' }));
    await expect(notifyWatchingEpisodes([arrival()], { groupingEnabled: true })).resolves.toBeUndefined();
    expect(mocks.userContext).toHaveBeenCalledTimes(2);
    expect(mocks.noteJobFailure).not.toHaveBeenCalled();
  });

  it('stops the batch once it has used its time budget, even when Jellyfin keeps answering slowly', async () => {
    mocks.findUsers.mockResolvedValue([user({ id: 'u-1', jellyfinUserId: 'jf-1' }), user()]);
    mocks.userContext.mockImplementation(async (u: { jellyfinUserId: string }) => {
      // A slow answer (or a stale-cache fallback after a timeout) for the first person.
      vi.setSystemTime(Date.now() + WATCHING_BATCH_BUDGET_MS + 1);
      return { client, connectionFingerprint: 'fp', jellyfinUserId: u.jellyfinUserId };
    });
    await expect(notifyWatchingEpisodes([arrival()], { groupingEnabled: true })).resolves.toBeUndefined();
    expect(mocks.userContext).toHaveBeenCalledTimes(1);
  });

  it('skips only one slow account when the next one answers', async () => {
    mocks.findUsers.mockResolvedValue([user({ id: 'u-slow', jellyfinUserId: 'jf-slow' }), user()]);
    mocks.userContext.mockImplementation(async (u: { jellyfinUserId: string }) => {
      if (u.jellyfinUserId === 'jf-slow') throw Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' });
      return { client, connectionFingerprint: 'fp', jellyfinUserId: u.jellyfinUserId };
    });
    await notifyWatchingEpisodes([arrival()], { groupingEnabled: true });
    expect(calls().map(([e]) => e.ownerUserId)).toEqual(['u-ana']);
  });

  it.each([400, 500])('skips only the person Jellyfin answers %i for (say, a deleted Jellyfin user)', async (status) => {
    mocks.findUsers.mockResolvedValue([user({ id: 'u-gone', jellyfinUserId: 'jf-gone' }), user()]);
    mocks.userContext.mockImplementation(async (u: { jellyfinUserId: string }) => {
      if (u.jellyfinUserId === 'jf-gone') throw Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } });
      return { client, connectionFingerprint: 'fp', jellyfinUserId: u.jellyfinUserId };
    });
    await notifyWatchingEpisodes([arrival()], { groupingEnabled: true });
    expect(calls().map(([e]) => e.ownerUserId)).toEqual(['u-ana']);
  });

  it('looks series up in chunks, so a long play history never makes too long a URL', async () => {
    client = jellyfin(Array.from({ length: 250 }, (_, i) => ({ seriesId: `jf-${i}`, tvdb: String(i + 1), daysAgo: 1 })));
    const played = await fetchPlayedSeries(client as never);
    const lookups = client.queryItems.mock.calls.filter(([p]) => p.Ids).map(([p]) => String(p.Ids).split(',').length);
    expect(lookups).toEqual([100, 100, 50]);
    expect(played).toHaveLength(250);
  });

  it('never throws when the database fails', async () => {
    mocks.findUsers.mockRejectedValue(new Error('db down'));
    await expect(notifyWatchingEpisodes([arrival()], { groupingEnabled: true })).resolves.toBeUndefined();
    mocks.findUsers.mockResolvedValue([user()]);
    mocks.claim.mockRejectedValue(new Error('db down'));
    await expect(notifyWatchingEpisodes([arrival()], { groupingEnabled: true })).resolves.toBeUndefined();
    expect(mocks.noteJobFailure).toHaveBeenCalledTimes(2);
    expect(calls()).toHaveLength(0);
  });
});
