import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetQBittorrentSyncForTests } from '@/lib/qbittorrent-sync';

/*
 * QBT-29: the summary on several qBittorrents. A list (and its delta cursor)
 * is one instance's; the dashboard's counters (instanceId=all) add every
 * instance up, and leave out one that does not answer.
 */
const mocks = vi.hoisted(() => ({ answers: {} as Record<string, unknown> }));
const client = (instanceId: string) => ({
  instanceId,
  connectionKey: `key-${instanceId}`,
  getMaindata: vi.fn(async () => {
    const answer = mocks.answers[instanceId];
    if (answer instanceof Error) throw answer;
    return answer;
  }),
});
const clients = { q1: client('q1'), q2: client('q2') };
vi.mock('@/lib/auth', () => ({ requireUserCapability: async () => ({ ok: true, user: { id: 'u1' }, session: {} }) }));
vi.mock('@/lib/arr-instances', () => ({ listConnections: async () => [{ id: 'q1' }, { id: 'q2' }] }));
vi.mock('@/lib/service-helpers', () => ({
  getQBittorrentClient: vi.fn(async (id?: string) => clients[(id ?? 'q1') as 'q1' | 'q2']),
  getQBittorrentClients: vi.fn(async () => Object.entries(clients).map(([id, c]) => ({ connection: { id }, client: c }))),
}));
vi.mock('@/lib/cache/qbittorrent-version', () => ({ getQbitCacheVersion: vi.fn(async () => 1) }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/server-perf', () => ({ logApiDuration: vi.fn() }));

import { GET } from '@/app/api/qbittorrent/summary/route';

const state = (speed: number, limit: number, alt: boolean) => ({
  dl_info_speed: speed, dl_info_data: 100, up_info_speed: speed / 2, up_info_data: 50, dl_rate_limit: limit, up_rate_limit: limit,
  dht_nodes: 10, connection_status: 'connected', use_alt_speed_limits: alt,
});
const full = (torrents: Record<string, { state: string; progress: number }>, serverState: Record<string, unknown>) => ({
  rid: 1, full_update: true, torrents: Object.fromEntries(Object.entries(torrents).map(([hash, t]) => [hash, { name: hash, ...t }])), server_state: serverState,
});
const get = async (query: string) => (await GET(new NextRequest(`http://localhost/api/qbittorrent/summary${query}`))).json();

beforeEach(() => {
  resetQBittorrentSyncForTests();
  mocks.answers = {
    q1: full({ a: { state: 'downloading', progress: 0.5 }, b: { state: 'uploading', progress: 1 } }, state(1000, 0, true)),
    q2: full({ c: { state: 'downloading', progress: 0.1 } }, state(500, 2048, true)),
  };
});

describe('the torrents summary on several qBittorrents (QBT-29)', () => {
  it("lists the named instance's torrents only", async () => {
    expect((await get('?instanceId=q2')).torrents.map((t: { hash: string }) => t.hash)).toEqual(['c']);
    expect((await get('')).torrents.map((t: { hash: string }) => t.hash)).toEqual(['a', 'b']);
  });

  it('says which qBittorrent it read, so the page acts on the one it shows', async () => {
    expect((await get('?view=delta')).instanceId).toBe('q1');
    expect((await get('?view=delta&instanceId=q2')).instanceId).toBe('q2');
  });

  it("never answers one instance's delta cursor with another's list", async () => {
    const first = await get('?view=delta&instanceId=q1');
    const other = await get(`?view=delta&instanceId=q2&cursor=${first.cursor}`);
    // Another instance's cursor is a full reset, never a diff against q1's list.
    expect(other.reset).toBe(true);
    expect(other.removed).toEqual([]);
    expect(other.changed.map((t: { hash: string }) => t.hash)).toEqual(['c']);
  });

  it('adds every instance up for the dashboard', async () => {
    expect(await get('?view=counters&instanceId=all')).toEqual({
      total: 3, downloading: 2, seeding: 1, paused: 0,
      transferInfo: expect.objectContaining({ dl_info_speed: 1500, up_info_speed: 750, dl_info_data: 200, dl_rate_limit: 0, dht_nodes: 20 }),
      speedLimitsMode: 1,
    });
  });

  it('leaves out an instance that does not answer', async () => {
    mocks.answers.q2 = new Error('qBittorrent did not answer');
    expect(await get('?view=counters&instanceId=all')).toEqual(expect.objectContaining({ total: 2, downloading: 1, seeding: 1 }));
  });
});
