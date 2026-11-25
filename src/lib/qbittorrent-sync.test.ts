import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QBittorrentClient } from '@/lib/qbittorrent-client';
import {
  QBittorrentSync,
  forgetQBittorrentSyncsExcept,
  qbittorrentSyncFor,
  resetQBittorrentSyncForTests,
  speedLimitsModeFrom,
  transferInfoFrom,
} from './qbittorrent-sync';

const PASSKEY_URL = 'https://tracker.invalid/SECRETPASSKEY/announce';

function fakeClient(connectionKey = 'k1', instanceId?: string) {
  const answers: Array<unknown | Error | (() => Promise<unknown>)> = [];
  const rids: number[] = [];
  const getMaindata = vi.fn(async (rid: number) => {
    rids.push(rid);
    const next = answers.shift();
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return (next as () => Promise<unknown>)();
    return next;
  });
  return { client: { getMaindata, connectionKey, instanceId } as unknown as QBittorrentClient, answers, rids, getMaindata };
}

const full = (rid: number, torrents: Record<string, Record<string, unknown>>, serverState: Record<string, unknown> = { dl_info_speed: 1 }) => ({
  rid, full_update: true, torrents, server_state: serverState, trackers: { [PASSKEY_URL]: Object.keys(torrents) }, categories: {}, tags: [],
});

describe('QBittorrentSync', () => {
  let now = 1_000;
  const clock = () => now;
  beforeEach(() => {
    now = 1_000;
  });

  it('starts with a full update and keys each row by its hash', async () => {
    const { client, answers, rids } = fakeClient();
    answers.push(full(1, { aaa: { name: 'A', state: 'metaDL', tracker: PASSKEY_URL }, bbb: { name: 'B', state: 'uploading' } }));
    const sync = new QBittorrentSync(client, clock);
    const snapshot = await sync.read(2_000);
    expect(rids).toEqual([0]);
    expect(snapshot.torrents.map((t) => [t.hash, t.name])).toEqual([['aaa', 'A'], ['bbb', 'B']]);
    expect(snapshot.serverState).toEqual({ dl_info_speed: 1 });
    // The trackers map (announce URLs with passkeys) is not kept anywhere.
    expect(JSON.stringify(snapshot)).not.toContain('trackers');
  });

  it('merges changed fields, removals and server_state from the rid it was given, without changing an earlier snapshot', async () => {
    const { client, answers, rids } = fakeClient();
    answers.push(
      full(1, { aaa: { name: 'A', state: 'downloading', progress: 0.1 }, bbb: { name: 'B', state: 'uploading' } }, { dl_info_speed: 1, dht_nodes: 5 }),
      { rid: 2, torrents: { aaa: { progress: 0.5 }, ccc: { name: 'C', state: 'metaDL' } }, torrents_removed: ['bbb'], server_state: { dl_info_speed: 9 } },
    );
    const sync = new QBittorrentSync(client, clock);
    const first = await sync.read(2_000);
    now += 2_000;
    const second = await sync.read(2_000);
    expect(rids).toEqual([0, 1]);
    expect(second.torrents).toEqual([
      { hash: 'aaa', name: 'A', state: 'downloading', progress: 0.5 },
      { hash: 'ccc', name: 'C', state: 'metaDL' },
    ]);
    expect(second.serverState).toEqual({ dl_info_speed: 9, dht_nodes: 5 });
    expect(first.torrents[0].progress).toBe(0.1);
    expect(first.torrents).toHaveLength(2);
  });

  it('an empty incremental answer keeps everything', async () => {
    const { client, answers } = fakeClient();
    answers.push(full(1, { aaa: { name: 'A' } }), { rid: 2 });
    const sync = new QBittorrentSync(client, clock);
    await sync.read(0);
    const snapshot = await sync.read(0);
    expect(snapshot.torrents).toEqual([{ hash: 'aaa', name: 'A' }]);
    expect(snapshot.serverState).toEqual({ dl_info_speed: 1 });
  });

  it('a full_update replaces the list and server_state, even mid-way (qBittorrent restarted: its rid starts again)', async () => {
    const { client, answers, rids } = fakeClient();
    answers.push(
      full(41, { aaa: { name: 'A' }, bbb: { name: 'B' } }, { dl_info_speed: 1, alltime_dl: 10 }),
      full(1, { bbb: { name: 'B again' } }, { dl_info_speed: 0 }),
      { rid: 2, torrents: { bbb: { state: 'stoppedDL' } } },
    );
    const sync = new QBittorrentSync(client, clock);
    await sync.read(0);
    const restarted = await sync.read(0);
    expect(restarted.torrents).toEqual([{ hash: 'bbb', name: 'B again' }]);
    expect(restarted.serverState).toEqual({ dl_info_speed: 0 });
    const after = await sync.read(0);
    expect(rids).toEqual([0, 41, 1]);
    expect(after.torrents).toEqual([{ hash: 'bbb', name: 'B again', state: 'stoppedDL' }]);
  });

  it.each([
    ['a failed read', new Error('timeout')],
    ['an answer that is not maindata', 'Forbidden'],
    ['an answer without a rid', { torrents: {} }],
  ])('after %s, the next read starts again from rid 0', async (_label, bad) => {
    const { client, answers, rids } = fakeClient();
    answers.push(full(7, { aaa: { name: 'A' } }), bad, full(1, { zzz: { name: 'Z' } }));
    const sync = new QBittorrentSync(client, clock);
    await sync.read(0);
    await expect(sync.read(0)).rejects.toThrow();
    const snapshot = await sync.read(0);
    // A timed-out read may have been answered: reusing rid 7 would miss what that answer held.
    expect(rids).toEqual([0, 7, 0]);
    expect(snapshot.torrents).toEqual([{ hash: 'zzz', name: 'Z' }]);
  });

  it('serves a recent state without asking, and asks again once it is older than the window', async () => {
    const { client, answers, getMaindata } = fakeClient();
    answers.push(full(1, {}), { rid: 2 });
    const sync = new QBittorrentSync(client, clock);
    await sync.read(2_000);
    now += 1_999;
    await sync.read(2_000);
    expect(getMaindata).toHaveBeenCalledTimes(1);
    now += 1;
    await sync.read(2_000);
    expect(getMaindata).toHaveBeenCalledTimes(2);
  });

  it('a newer version (an action just ran) reads again inside the window; the poll, with none, does not', async () => {
    const { client, answers, rids } = fakeClient();
    answers.push(full(1, {}), { rid: 2 }, { rid: 3 });
    const sync = new QBittorrentSync(client, clock);
    await sync.read(2_000, 4);
    await sync.read(2_000, 4);
    await sync.read(2_000);
    expect(rids).toEqual([0]);
    await sync.read(2_000, 5);
    expect(rids).toEqual([0, 1]);
  });

  it('never has two reads out at once: callers share one, and a read for a newer version waits for it', async () => {
    const { client, answers, rids } = fakeClient();
    let release!: () => void;
    let open = 0;
    let maxOpen = 0;
    const slow = (answer: unknown) => () => {
      open++;
      maxOpen = Math.max(maxOpen, open);
      return new Promise((resolve) => { release = () => { open--; resolve(answer); }; });
    };
    answers.push(slow(full(1, { aaa: { name: 'A' } })), slow({ rid: 2, torrents: { aaa: { name: 'A2' } } }));
    const sync = new QBittorrentSync(client, clock);
    const a = sync.read(2_000, 1);
    const b = sync.read(2_000, 1);
    const poll = sync.read(2_000);
    const c = sync.read(2_000, 2);
    await vi.waitFor(() => expect(rids).toEqual([0]));
    release();
    expect((await a).torrents[0].name).toBe('A');
    expect(await b).toBe(await a);
    expect(await poll).toBe(await a);
    await vi.waitFor(() => expect(rids).toEqual([0, 1]));
    release();
    expect((await c).torrents[0].name).toBe('A2');
    expect(maxOpen).toBe(1);
  });

  it('a queued read still runs when the one before it failed', async () => {
    const { client, answers, rids } = fakeClient();
    let fail!: () => void;
    answers.push(() => new Promise((_resolve, reject) => { fail = () => reject(new Error('down')); }), full(3, { aaa: { name: 'A' } }));
    const sync = new QBittorrentSync(client, clock);
    const first = sync.read(2_000, 1);
    const second = sync.read(2_000, 2);
    await vi.waitFor(() => expect(rids).toEqual([0]));
    fail();
    await expect(first).rejects.toThrow('down');
    expect((await second).torrents).toEqual([{ hash: 'aaa', name: 'A' }]);
    expect(rids).toEqual([0, 0]);
  });
});

describe('qbittorrentSyncFor', () => {
  beforeEach(() => resetQBittorrentSyncForTests());

  it('shares one state per connection, even across client objects, and starts again for another', () => {
    const one = fakeClient('k1').client;
    const sameSetting = fakeClient('k1').client;
    const other = fakeClient('k2').client;
    const sync = qbittorrentSyncFor(one);
    expect(qbittorrentSyncFor(sameSetting)).toBe(sync);
    const next = qbittorrentSyncFor(other);
    expect(next).not.toBe(sync);
    expect(next.client).toBe(other);
  });

  // QBT-29: two qBittorrents never share a list or a response id.
  it('keeps one state per qBittorrent instance, each with its own list and rid', async () => {
    const first = fakeClient('k1', 'q1');
    const second = fakeClient('k2', 'q2');
    first.answers.push(full(5, { aaa: { name: 'A' } }), { rid: 6, torrents: { aaa: { progress: 1 } } });
    second.answers.push(full(9, { bbb: { name: 'B' } }));
    const one = qbittorrentSyncFor(first.client);
    const two = qbittorrentSyncFor(second.client);
    expect(two).not.toBe(one);
    expect((await one.read()).torrents.map((t) => t.hash)).toEqual(['aaa']);
    expect((await two.read()).torrents.map((t) => t.hash)).toEqual(['bbb']);
    // Reading the second didn't replace the first: it goes on from its own rid.
    expect(qbittorrentSyncFor(first.client)).toBe(one);
    await one.read(0);
    expect(first.rids).toEqual([0, 5]);
    expect(second.rids).toEqual([0]);
  });

  it('starts an instance again when its setting changes, and lets a removed one go', () => {
    const one = qbittorrentSyncFor(fakeClient('k1', 'q1').client);
    const two = qbittorrentSyncFor(fakeClient('k2', 'q2').client);
    const moved = qbittorrentSyncFor(fakeClient('k1-new-password', 'q1').client);
    expect(moved).not.toBe(one);
    forgetQBittorrentSyncsExcept(['q1']);
    expect(qbittorrentSyncFor(fakeClient('k1-new-password', 'q1').client)).toBe(moved);
    expect(qbittorrentSyncFor(fakeClient('k2', 'q2').client)).not.toBe(two);
  });
});

describe('the figures copied out of server_state', () => {
  const serverState = {
    dl_info_speed: 1, dl_info_data: 2, up_info_speed: 3, up_info_data: 4, dl_rate_limit: 5, up_rate_limit: 6, dht_nodes: 7,
    connection_status: 'connected', last_external_address_v4: '203.0.113.7', last_external_address_v6: '2001:db8::7',
    use_alt_speed_limits: true, alltime_dl: 9, free_space_on_disk: 10, global_ratio: '1.5', queueing: true, refresh_interval: 1500,
  };

  it('transfer info is the eight shown fields, never the public address', () => {
    const info = transferInfoFrom(serverState);
    expect(Object.keys(info!).sort()).toEqual([
      'connection_status', 'dht_nodes', 'dl_info_data', 'dl_info_speed', 'dl_rate_limit', 'up_info_data', 'up_info_speed', 'up_rate_limit',
    ]);
    expect(JSON.stringify(info)).not.toContain('203.0.113.7');
    expect(transferInfoFrom(null)).toBeNull();
  });

  it('the speed mode is 1 with the alternative limits on, else 0', () => {
    expect(speedLimitsModeFrom(serverState)).toBe(1);
    expect(speedLimitsModeFrom({ use_alt_speed_limits: false })).toBe(0);
    expect(speedLimitsModeFrom(null)).toBe(0);
  });
});
