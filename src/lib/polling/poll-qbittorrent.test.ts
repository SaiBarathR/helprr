import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getTorrents: vi.fn(),
  saved: null as unknown,
  notifyAndLog: vi.fn<(event: unknown) => Promise<number>>(async () => 1),
  unwanted: new Set<string>(),
}));

vi.mock('@/lib/service-helpers', () => ({ getQBittorrentClient: vi.fn(async () => ({ getTorrents: mocks.getTorrents })) }));
vi.mock('@/lib/arr-instances', () => ({ getDefaultConnection: vi.fn(async () => ({ id: 'q1' })) }));
vi.mock('@/lib/cache/badge-counts', () => ({ writeBadgeSlice: vi.fn() }));
vi.mock('@/lib/polling-job-report', () => ({ noteJobFailure: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/db', () => ({
  prisma: {
    pollingState: {
      update: vi.fn(async ({ data }: { data: { lastQueueIds: unknown } }) => { mocks.saved = data.lastQueueIds; }),
    },
  },
}));
vi.mock('./shared', () => ({
  // The saved list is the next poll's state; null is a first run.
  getPollingState: vi.fn(async () => ({ state: { lastQueueIds: mocks.saved }, firstRun: mocks.saved === null })),
  notifyAndLog: mocks.notifyAndLog,
  // Someone takes every event unless a test says otherwise.
  wantedNotices: vi.fn(async (notices: Array<{ event: { eventType: string } }>) => notices.filter((n) => !mocks.unwanted.has(n.event.eventType))),
}));

import { pollQBittorrent } from './poll-qbittorrent';
import type { CycleContext } from './shared';

const START = Date.parse('2026-11-25T10:00:00Z');
let stalledAfterMins = 30;

async function poll(at: number, torrents: Array<{ hash: string; state: string; progress?: number; name?: string }>) {
  vi.setSystemTime(at);
  mocks.getTorrents.mockResolvedValue(torrents.map((t) => ({ progress: 0.5, name: t.hash.toUpperCase(), ...t })));
  mocks.notifyAndLog.mockClear();
  const context = {
    getSettings: async () => ({ notificationGroupingEnabled: false, torrentStalledAlertMins: stalledAfterMins }),
  } as unknown as CycleContext;
  await pollQBittorrent(context);
  return mocks.notifyAndLog.mock.calls.map(([event]) => event as { eventType: string; title: string; body: string; url: string });
}

const minutes = (n: number) => START + n * 60_000;
const types = (events: Array<{ eventType: string }>) => events.map((e) => e.eventType);

beforeEach(() => {
  vi.useFakeTimers();
  mocks.saved = [];
  mocks.unwanted.clear();
  stalledAfterMins = 30;
});

describe('pollQBittorrent: errored, missing files and stalled torrents (QBT-12)', () => {
  it('pushes once when a torrent errors, not again while it stays errored, and again after it recovers', async () => {
    await poll(minutes(0), [{ hash: 'a', state: 'downloading' }]);

    const entered = await poll(minutes(1), [{ hash: 'a', state: 'error' }]);
    expect(entered).toEqual([expect.objectContaining({
      eventType: 'torrentErrored', title: 'Torrent Errored', body: 'A', url: '/torrents/a/settings',
    })]);

    expect(await poll(minutes(2), [{ hash: 'a', state: 'error' }])).toEqual([]);
    expect(await poll(minutes(3), [{ hash: 'a', state: 'downloading' }])).toEqual([]);
    expect(types(await poll(minutes(4), [{ hash: 'a', state: 'error' }]))).toEqual(['torrentErrored']);
  });

  it('names missing files, and moving between error and missingFiles is one problem', async () => {
    await poll(minutes(0), [{ hash: 'a', state: 'uploading', progress: 1 }]);
    const missing = await poll(minutes(1), [{ hash: 'a', state: 'missingFiles', progress: 1 }]);
    expect(missing).toEqual([expect.objectContaining({ eventType: 'torrentErrored', title: 'Torrent Files Missing' })]);
    expect(await poll(minutes(2), [{ hash: 'a', state: 'error', progress: 1 }])).toEqual([]);
  });

  it('pushes for a torrent that is new and already errored', async () => {
    await poll(minutes(0), []);
    expect(types(await poll(minutes(1), [{ hash: 'n', state: 'missingFiles' }]))).toEqual(['torrentAdded', 'torrentErrored']);
  });

  it('only records on a first run and on state saved before these marks', async () => {
    mocks.saved = null;
    expect(await poll(minutes(0), [{ hash: 'a', state: 'error' }])).toEqual([]);
    expect(await poll(minutes(1), [{ hash: 'a', state: 'error' }])).toEqual([]);

    mocks.saved = [{ hash: 'b', progress: 0.5, name: 'B' }];
    expect(await poll(minutes(2), [{ hash: 'b', state: 'missingFiles' }])).toEqual([]);
    expect(await poll(minutes(3), [{ hash: 'b', state: 'missingFiles' }])).toEqual([]);
  });

  it('pushes a stall once it lasts the set time, once, and only a new stall after data has flowed for that long', async () => {
    await poll(minutes(0), [{ hash: 's', state: 'stalledDL' }]);
    expect(await poll(minutes(29), [{ hash: 's', state: 'stalledDL' }])).toEqual([]);

    const due = await poll(minutes(30), [{ hash: 's', state: 'stalledDL' }]);
    expect(due).toEqual([expect.objectContaining({
      eventType: 'torrentStalled', title: 'Torrent Stalled', body: 'S · No data for 30 min', url: '/torrents/s/trackers?name=S',
    })]);
    expect(await poll(minutes(90), [{ hash: 's', state: 'stalledDL' }])).toEqual([]);

    // Data for the stall time (30 min) ends the stall; the next one is timed from its start.
    await poll(minutes(91), [{ hash: 's', state: 'downloading' }]);
    await poll(minutes(121), [{ hash: 's', state: 'downloading' }]);
    await poll(minutes(122), [{ hash: 's', state: 'stalledDL' }]);
    expect(await poll(minutes(151), [{ hash: 's', state: 'stalledDL' }])).toEqual([]);
    expect(types(await poll(minutes(152), [{ hash: 's', state: 'stalledDL' }]))).toEqual(['torrentStalled']);
  });

  it('keeps a torrent that flickers out of the stall for a moment as one stall, with one push', async () => {
    await poll(minutes(0), [{ hash: 's', state: 'stalledDL' }]);
    expect(types(await poll(minutes(30), [{ hash: 's', state: 'stalledDL' }]))).toEqual(['torrentStalled']);
    for (let m = 31; m < 200; m += 2) {
      expect(await poll(minutes(m), [{ hash: 's', state: 'downloading' }])).toEqual([]);
      expect(await poll(minutes(m + 1), [{ hash: 's', state: 'stalledDL' }])).toEqual([]);
    }
  });

  it('times a stall again from the start when data flows before its push', async () => {
    await poll(minutes(0), [{ hash: 's', state: 'stalledDL' }]);
    await poll(minutes(20), [{ hash: 's', state: 'downloading' }]);
    await poll(minutes(21), [{ hash: 's', state: 'stalledDL' }]);
    expect(await poll(minutes(50), [{ hash: 's', state: 'stalledDL' }])).toEqual([]);
    expect(types(await poll(minutes(51), [{ hash: 's', state: 'stalledDL' }]))).toEqual(['torrentStalled']);
  });

  it('does not announce again a torrent still errored after qBittorrent checks it on restart', async () => {
    await poll(minutes(0), [{ hash: 'a', state: 'uploading', progress: 1 }]);
    expect(types(await poll(minutes(1), [{ hash: 'a', state: 'missingFiles', progress: 1 }]))).toEqual(['torrentErrored']);
    expect(await poll(minutes(2), [{ hash: 'a', state: 'checkingResumeData', progress: 1 }])).toEqual([]);
    expect(await poll(minutes(3), [{ hash: 'a', state: 'missingFiles', progress: 1 }])).toEqual([]);
  });

  it('counts a magnet stuck on its metadata, and follows the set time', async () => {
    stalledAfterMins = 120;
    await poll(minutes(0), [{ hash: 'm', state: 'metaDL', progress: 0 }]);
    expect(await poll(minutes(60), [{ hash: 'm', state: 'forcedMetaDL', progress: 0 }])).toEqual([]);
    const due = await poll(minutes(120), [{ hash: 'm', state: 'metaDL', progress: 0 }]);
    expect(due.map((e) => e.body)).toEqual(['M · No metadata for 2 h']);
  });

  it('never counts a paused, queued or seeding torrent as stalled', async () => {
    await poll(minutes(0), [{ hash: 'p', state: 'stoppedDL' }, { hash: 'q', state: 'queuedDL' }, { hash: 'u', state: 'stalledUP', progress: 1 }]);
    expect(await poll(minutes(600), [{ hash: 'p', state: 'stoppedDL' }, { hash: 'q', state: 'queuedDL' }, { hash: 'u', state: 'stalledUP', progress: 1 }])).toEqual([]);
  });

  it('sends nothing while nobody takes the event, and still records it, so turning it on later does not replay it', async () => {
    mocks.unwanted.add('torrentErrored');
    await poll(minutes(0), [{ hash: 'a', state: 'downloading' }]);
    expect(await poll(minutes(1), [{ hash: 'a', state: 'error' }])).toEqual([]);
    mocks.unwanted.clear();
    expect(await poll(minutes(2), [{ hash: 'a', state: 'error' }])).toEqual([]);
  });
});
