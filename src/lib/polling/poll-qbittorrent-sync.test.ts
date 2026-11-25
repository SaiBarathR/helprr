import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The poll on the shared sync/maindata state (src/lib/qbittorrent-sync.ts):
 * incremental answers carry only changed fields and removed hashes, and must
 * give the same pushes a full list did.
 */
const mocks = vi.hoisted(() => ({
  answers: [] as unknown[],
  rids: [] as number[],
  saved: null as unknown,
  notifyAndLog: vi.fn<(event: unknown) => Promise<number>>(async () => 1),
}));
const client = vi.hoisted(() => ({
  connectionKey: 'poll-sync-test',
  instanceId: 'q1',
  getMaindata: async (rid: number) => {
    mocks.rids.push(rid);
    return mocks.answers.shift();
  },
}));

vi.mock('@/lib/service-helpers', () => ({
  getQBittorrentClients: vi.fn(async () => [{ connection: { id: 'q1', label: 'qBittorrent' }, client }]),
}));
vi.mock('@/lib/cache/badge-counts', () => ({ writeBadgeSlice: vi.fn() }));
vi.mock('@/lib/polling-job-report', () => ({ noteJobFailure: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/db', () => ({
  prisma: { pollingState: { update: vi.fn(async ({ data }: { data: { lastQueueIds: unknown } }) => { mocks.saved = data.lastQueueIds; }) } },
}));
vi.mock('./shared', () => ({
  getPollingState: vi.fn(async () => ({ state: { lastQueueIds: mocks.saved }, firstRun: mocks.saved === null })),
  notifyAndLog: mocks.notifyAndLog,
  wantedNotices: vi.fn(async (notices: unknown[]) => notices),
  instanceTitle: (base: string, label: string, count: number) => (count > 1 ? `${label} · ${base}` : base),
}));

import { pollQBittorrent } from './poll-qbittorrent';
import { qbittorrentSyncFor, resetQBittorrentSyncForTests } from '@/lib/qbittorrent-sync';
import type { CycleContext } from './shared';

const context = { getSettings: async () => ({ notificationGroupingEnabled: false, torrentStalledAlertMins: 30 }) } as unknown as CycleContext;

async function poll() {
  mocks.notifyAndLog.mockClear();
  await pollQBittorrent(context);
  return mocks.notifyAndLog.mock.calls.map(([event]) => {
    const { eventType, body } = event as { eventType: string; body: string };
    return `${eventType}:${body}`;
  });
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-25T10:00:00Z'), toFake: ['Date'] });
  resetQBittorrentSyncForTests();
  mocks.rids = [];
  mocks.saved = [];
  mocks.answers = [{
    rid: 1,
    full_update: true,
    torrents: {
      a: { name: 'A', progress: 0.5, state: 'downloading' },
      b: { name: 'B', progress: 1, state: 'uploading' },
      c: { name: 'C', progress: 0.2, state: 'downloading' },
    },
  }];
});

describe('pollQBittorrent on incremental sync/maindata', () => {
  it('a completion and a removal in an incremental answer give one push each, and changed speeds none', async () => {
    expect(await poll()).toEqual(['torrentAdded:A', 'torrentAdded:B', 'torrentAdded:C']);
    mocks.answers.push({ rid: 2, torrents: { a: { progress: 1, state: 'uploading' }, c: { dlspeed: 500 } }, torrents_removed: ['b'] });
    vi.advanceTimersByTime(30_000);
    expect(await poll()).toEqual(['torrentCompleted:A', 'torrentDeleted:B']);
    mocks.answers.push({ rid: 3, torrents: { c: { dlspeed: 700, eta: 60 } } });
    vi.advanceTimersByTime(30_000);
    expect(await poll()).toEqual([]);
    expect(mocks.rids).toEqual([0, 1, 2]);
    expect((mocks.saved as Array<{ hash: string }>).map((entry) => entry.hash)).toEqual(['a', 'c']);
  });

  it('a poll right after the torrents page read reuses that read', async () => {
    await qbittorrentSyncFor(client as never).read();
    vi.advanceTimersByTime(1_000);
    await poll();
    expect(mocks.rids).toEqual([0]);
  });
});
