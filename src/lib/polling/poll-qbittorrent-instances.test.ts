import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * QBT-29: the poll on several qBittorrents. Each keeps its own state (its
 * PollingState row) and its own pushes, named and linked to that instance;
 * one that fails is skipped without touching the others; the downloads badge
 * counts every instance that answered.
 */
const mocks = vi.hoisted(() => ({
  lists: {} as Record<string, Array<{ hash: string; name: string; progress: number; state: string }> | Error>,
  saved: {} as Record<string, unknown>,
  notified: [] as Array<{ eventType: string; title: string; url: string; metadata: Record<string, unknown> }>,
  badge: vi.fn(),
}));

function instance(id: string, label: string) {
  return {
    connection: { id, label },
    client: {
      instanceId: id,
      connectionKey: `key-${id}`,
      getMaindata: async () => {
        const list = mocks.lists[id];
        if (list instanceof Error) throw list;
        return { rid: 1, full_update: true, torrents: Object.fromEntries(list.map(({ hash, ...fields }) => [hash, fields])) };
      },
    },
  };
}

vi.mock('@/lib/service-helpers', () => ({
  getQBittorrentClients: vi.fn(async () => [instance('q1', 'Main'), instance('q2', 'Seedbox')]),
}));
vi.mock('@/lib/cache/badge-counts', () => ({ writeBadgeSlice: mocks.badge }));
vi.mock('@/lib/polling-job-report', () => ({ noteJobFailure: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/db', () => ({
  prisma: {
    pollingState: {
      update: vi.fn(async ({ where, data }: { where: { serviceConnectionId: string }; data: { lastQueueIds: unknown } }) => {
        mocks.saved[where.serviceConnectionId] = data.lastQueueIds;
      }),
    },
  },
}));
vi.mock('./shared', async () => ({
  getPollingState: vi.fn(async (id: string) => ({ state: { lastQueueIds: mocks.saved[id] ?? null }, firstRun: !(id in mocks.saved) })),
  notifyAndLog: vi.fn(async (event: (typeof mocks.notified)[number]) => {
    mocks.notified.push(event);
    return 1;
  }),
  wantedNotices: vi.fn(async (notices: unknown[]) => notices),
  instanceTitle: (await vi.importActual<typeof import('./shared')>('./shared')).instanceTitle,
}));

import { pollQBittorrent } from './poll-qbittorrent';
import { resetQBittorrentSyncForTests } from '@/lib/qbittorrent-sync';
import type { CycleContext } from './shared';

const context = { getSettings: async () => ({ notificationGroupingEnabled: false, torrentStalledAlertMins: 30 }) } as unknown as CycleContext;
const torrent = (hash: string, progress = 0.5, state = 'downloading') => ({ hash, name: hash.toUpperCase(), progress, state });

beforeEach(() => {
  resetQBittorrentSyncForTests();
  mocks.saved = { q1: [], q2: [] };
  mocks.notified = [];
  mocks.badge.mockClear();
});

describe('pollQBittorrent on several qBittorrents (QBT-29)', () => {
  it('keeps each instance apart: its own state, pushes named and linked to it', async () => {
    mocks.lists = { q1: [torrent('same')], q2: [torrent('same', 0.2), torrent('other')] };
    await pollQBittorrent(context);

    expect(mocks.notified.map((event) => [event.title, event.url, event.metadata.instanceId])).toEqual([
      ['Main · Torrent Added', '/torrents?instance=q1', 'q1'],
      ['Seedbox · Torrent Added', '/torrents?instance=q2', 'q2'],
      ['Seedbox · Torrent Added', '/torrents?instance=q2', 'q2'],
    ]);
    expect((mocks.saved.q1 as Array<{ hash: string }>).map((entry) => entry.hash)).toEqual(['same']);
    expect((mocks.saved.q2 as Array<{ hash: string }>).map((entry) => entry.hash)).toEqual(['same', 'other']);
    expect(mocks.badge).toHaveBeenCalledExactlyOnceWith('downloads', 'qbittorrent', { total: 3, attention: 0 });

    // The same hash finishing in one instance is that instance's news only.
    mocks.notified = [];
    resetQBittorrentSyncForTests();
    mocks.lists = { q1: [torrent('same', 1, 'uploading')], q2: [torrent('same', 0.3), torrent('other')] };
    await pollQBittorrent(context);
    expect(mocks.notified.map((event) => [event.eventType, event.title, event.url])).toEqual([
      ['torrentCompleted', 'Main · Download Complete', '/torrents?instance=q1'],
    ]);
  });

  it('skips an instance that does not answer, keeping its state, and still polls the other', async () => {
    mocks.saved = { q1: [{ hash: 'kept', progress: 0.5, name: 'KEPT' }], q2: [] };
    mocks.lists = { q1: new Error('qBittorrent did not answer'), q2: [torrent('new')] };
    await pollQBittorrent(context);

    // Not "removed": q1 was not read.
    expect(mocks.notified.map((event) => [event.eventType, event.metadata.instanceId])).toEqual([['torrentAdded', 'q2']]);
    expect(mocks.saved.q1).toEqual([{ hash: 'kept', progress: 0.5, name: 'KEPT' }]);
    expect(mocks.badge).toHaveBeenCalledExactlyOnceWith('downloads', 'qbittorrent', { total: 1, attention: 0 });
  });
});
