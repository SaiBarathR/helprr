import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTorrentDelta, type TorrentDeltaResponse } from '@/lib/qbittorrent-delta';
import { resetQBittorrentSyncForTests } from '@/lib/qbittorrent-sync';
import type { QBittorrentSummaryResponse } from '@/types';

/*
 * The torrents summary is built from qBittorrent's sync/maindata, merged on the
 * server (src/lib/qbittorrent-sync.ts). What a browser gets keeps its old shape
 * (full, view=delta with a cursor, view=counters), every tab shares one
 * upstream read per window, and nothing an incremental answer carries (magnet,
 * tracker URL, public IP) reaches a browser.
 */

const PASSKEY = 'SECRETPASSKEY';
const ANNOUNCE = `https://tracker.invalid:8443/${PASSKEY}/announce`;
const PUBLIC_V4 = '203.0.113.77';
const PUBLIC_V6 = '2001:db8::77';

const mocks = vi.hoisted(() => ({
  requireUserCapability: vi.fn(),
  version: 1,
  answers: [] as unknown[],
  rids: [] as number[],
}));
const client = {
  connectionKey: 'summary-route-test',
  getMaindata: vi.fn(async (rid: number) => {
    mocks.rids.push(rid);
    return mocks.answers.shift();
  }),
};
vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.requireUserCapability }));
vi.mock('@/lib/service-helpers', () => ({ getQBittorrentClient: vi.fn(async () => client) }));
vi.mock('@/lib/cache/qbittorrent-version', () => ({ getQbitCacheVersion: vi.fn(async () => mocks.version) }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/server-perf', () => ({ logApiDuration: vi.fn() }));

import { GET } from '@/app/api/qbittorrent/summary/route';

const row = (name: string, state: string, extra: Record<string, unknown> = {}) => ({
  name, state, progress: state === 'uploading' ? 1 : 0, size: 10, dlspeed: 0, upspeed: 0, category: '', tags: '',
  magnet_uri: `magnet:?xt=urn:btih:x&tr=${encodeURIComponent(ANNOUNCE)}`, tracker: ANNOUNCE, ...extra,
});
const serverState = {
  dl_info_speed: 1, dl_info_data: 2, up_info_speed: 3, up_info_data: 4, dl_rate_limit: 0, up_rate_limit: 0, dht_nodes: 0,
  connection_status: 'connected', use_alt_speed_limits: false, last_external_address_v4: PUBLIC_V4, last_external_address_v6: PUBLIC_V6,
  alltime_dl: 5, free_space_on_disk: 6,
};
const FIRST = {
  rid: 1, full_update: true, server_state: serverState, trackers: { [ANNOUNCE]: ['aaa', 'bbb', 'ccc'] },
  torrents: { aaa: row('Alpha', 'downloading'), bbb: row('Bravo', 'uploading'), ccc: row('Charlie', 'metaDL') },
};
// What qBittorrent sends next: a speed, a new tracker and magnet, a removal and a new public address.
const SECOND = {
  rid: 2,
  torrents: {
    aaa: { dlspeed: 500, tracker: `${ANNOUNCE}?again=1`, magnet_uri: `magnet:?xt=urn:btih:x&tr=${PASSKEY}` },
    ddd: row('Delta', 'stalledDL'),
  },
  torrents_removed: ['ccc'],
  server_state: { dl_info_speed: 500, use_alt_speed_limits: true, last_external_address_v4: '198.51.100.1' },
  trackers: { [`${ANNOUNCE}?again=1`]: ['aaa', 'ddd'] },
};

function signInAs(id: string) {
  mocks.requireUserCapability.mockResolvedValue({ ok: true, user: { id, role: 'member' }, session: {} });
}
async function get(query: string) {
  const response = await GET(new NextRequest(`http://localhost/api/qbittorrent/summary${query}`));
  const text = await response.text();
  return { response, text, json: JSON.parse(text) };
}
function expectNothingSecret(text: string) {
  for (const secret of [PASSKEY, PUBLIC_V4, PUBLIC_V6, '198.51.100.1', 'magnet:', 'announce', 'last_external_address', 'magnet_uri', '"tracker"']) {
    expect(text).not.toContain(secret);
  }
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-25T10:00:00Z'), toFake: ['Date'] });
  vi.clearAllMocks();
  resetQBittorrentSyncForTests();
  mocks.version = 1;
  mocks.answers = [FIRST, SECOND];
  mocks.rids = [];
  signInAs('u1');
});
afterEach(() => vi.useRealTimers());

describe('GET /api/qbittorrent/summary on sync/maindata', () => {
  it('two browsers polling inside the window share one upstream read', async () => {
    signInAs('u1');
    const one = await get('?view=delta');
    signInAs('u2');
    const two = await get('?view=delta');
    const widget = await get('?view=counters');
    expect(mocks.rids).toEqual([0]);
    expect(one.json.reset).toBe(true);
    expect(two.json.reset).toBe(true);
    expect(widget.json).toMatchObject({ total: 3, downloading: 2, seeding: 1, paused: 0 });
  });

  it('a delta after a change carries the changed fields and removals only, as before', async () => {
    const first = await get('?view=delta');
    vi.advanceTimersByTime(2_000);
    const second = await get(`?view=delta&cursor=${first.json.cursor}`);
    expect(mocks.rids).toEqual([0, 1]);
    const delta = second.json as TorrentDeltaResponse;
    expect(delta.reset).toBe(false);
    expect(delta.removed).toEqual(['ccc']);
    expect(delta.changed).toEqual([
      { hash: 'aaa', dlspeed: 500 },
      expect.objectContaining({ hash: 'ddd', name: 'Delta', state: 'stalledDL', tracker_host: 'tracker.invalid' }),
    ]);
    expect(delta.speedLimitsMode).toBe(1);
    expect(delta.transferInfo).toMatchObject({ dl_info_speed: 500, up_info_speed: 3 });

    // The browser's applied state is what a full read would give.
    const applied = applyTorrentDelta(applyTorrentDelta(undefined, first.json), delta);
    const fullNow = (await get('')).json as QBittorrentSummaryResponse;
    expect(applied).toEqual(fullNow);
    expect(fullNow.torrents.map((t) => t.hash)).toEqual(['aaa', 'bbb', 'ddd']);
  });

  it.each(['', '?view=delta', '?view=counters', '?filter=downloading&view=delta'])(
    'no magnet, tracker URL or public address in %s, before or after an incremental answer',
    async (query) => {
      const first = await get(query);
      expectNothingSecret(first.text);
      vi.advanceTimersByTime(2_000);
      const cursor = first.json.cursor ? `&cursor=${first.json.cursor}` : '';
      const second = await get(`${query}${cursor}`);
      expect(mocks.rids).toEqual([0, 1]);
      expectNothingSecret(second.text);
      if (second.json.transferInfo) expect(Object.keys(second.json.transferInfo)).toHaveLength(8);
    },
  );

  it("one status filter slims the list to what the page shows for it", async () => {
    const { json } = await get('?filter=downloading');
    expect(json.torrents.map((t: { hash: string }) => t.hash)).toEqual(['aaa', 'ccc']);
    const seeding = await get('?filter=seeding');
    expect(seeding.json.torrents.map((t: { hash: string }) => t.hash)).toEqual(['bbb']);
    expect(mocks.rids).toEqual([0]);
  });

  it('an action (version bump) reads again at once, so the refetch after it is current', async () => {
    await get('?view=delta');
    mocks.version = 2;
    const after = await get('?view=delta');
    expect(mocks.rids).toEqual([0, 1]);
    expect(after.json.reset).toBe(true);
    expect(after.json.changed.map((t: { hash: string }) => t.hash)).toEqual(['aaa', 'bbb', 'ddd']);
  });

  it('a failed read is a 500, and the next one is a full read', async () => {
    mocks.answers = ['<html>sign in</html>', FIRST];
    expect((await get('?view=delta')).response.status).toBe(500);
    expect((await get('?view=delta')).response.status).toBe(200);
    expect(mocks.rids).toEqual([0, 0]);
  });

  it('checks torrents.view before reading qBittorrent', async () => {
    mocks.requireUserCapability.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
    const response = await GET(new NextRequest('http://localhost/api/qbittorrent/summary?view=delta'));
    expect(response.status).toBe(403);
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('torrents.view');
    expect(client.getMaindata).not.toHaveBeenCalled();
  });
});
