import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Peer IP addresses are personal data: only an admin is sent them. Everyone
 * with torrents.view gets the rest of each peer under an opaque key; a ban is
 * an admin's, names the peer by that key, and bans the address qBittorrent
 * lists under it, never one from the browser.
 */

const HASH = 'aaaabbbbccccddddeeeeffff0000111122223333';
const V4 = '198.51.100.7:51413';
const V6 = '[2001:db8::7]:6881';

const mocks = vi.hoisted(() => ({
  requireUserCapability: vi.fn(),
  requireAdmin: vi.fn(),
  recordSettingsUpdated: vi.fn(),
  client: {
    getTorrents: vi.fn(),
    getTorrentPeers: vi.fn(),
    addPeers: vi.fn(),
    banPeers: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  requireUserCapability: mocks.requireUserCapability,
  requireAdmin: mocks.requireAdmin,
}));
vi.mock('@/lib/service-helpers', () => ({ getQBittorrentClient: vi.fn(async () => mocks.client) }));
vi.mock('@/lib/security-audit', () => ({ recordSettingsUpdated: mocks.recordSettingsUpdated }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/server-perf', () => ({ logApiDuration: vi.fn() }));

import { GET, POST } from '@/app/api/qbittorrent/[hash]/peers/route';
import { POST as BAN } from '@/app/api/qbittorrent/[hash]/peers/ban/route';
import { peerKey } from '@/lib/qbittorrent-peers';

const peer = (ip: string, port: number) => ({
  ip, port, client: 'qBittorrent/5.1.4', peer_id_client: '-qB5140-', connection: 'BT', country: 'Canada', country_code: 'ca',
  flags: 'D H', flags_desc: 'D = Interested', progress: 0.5, relevance: 1, dl_speed: 1024, up_speed: 0,
  downloaded: 4096, uploaded: 0, files: 'ubuntu.iso',
});
const FULL = { rid: 1, full_update: true, show_flags: true, peers: { [V4]: peer('198.51.100.7', 51413), [V6]: peer('2001:db8::7', 6881) } };

const params = { params: Promise.resolve({ hash: HASH }) };
const get = (query = '') => GET(new NextRequest(`http://localhost/api/qbittorrent/${HASH}/peers${query}`), params);
const post = (body: unknown) =>
  POST(new NextRequest(`http://localhost/api/qbittorrent/${HASH}/peers`, { method: 'POST', body: JSON.stringify(body) }), params);
const ban = (body: unknown) =>
  BAN(new NextRequest(`http://localhost/api/qbittorrent/${HASH}/peers/ban`, { method: 'POST', body: JSON.stringify(body) }), params);

const user = (role: 'admin' | 'member') => ({ ok: true, user: { id: `${role}-1`, username: role, role }, session: {} });
const forbidden = () => ({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_SECRET = 'peers-route-test-secret';
  mocks.requireUserCapability.mockResolvedValue(user('member'));
  mocks.requireAdmin.mockResolvedValue(user('admin'));
  mocks.client.getTorrentPeers.mockResolvedValue(FULL);
  mocks.client.getTorrents.mockResolvedValue([{ hash: HASH, private: false }]);
  mocks.client.addPeers.mockResolvedValue({ added: 1, failed: 0 });
  mocks.client.banPeers.mockResolvedValue(undefined);
});

function expectNoAddress(body: unknown) {
  const json = JSON.stringify(body);
  for (const part of ['198.51.100.7', '2001:db8', '51413', '6881']) expect(json).not.toContain(part);
}

describe('GET /api/qbittorrent/[hash]/peers', () => {
  it('gives a member every peer without its address, under an opaque key', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expectNoAddress(body);
    expect(body).toMatchObject({ fullUpdate: true, showFlags: true, removed: [], private: false });
    expect(body.cursor).toMatch(/^[a-f0-9]{64}$/);
    const keys = Object.keys(body.peers);
    expect(keys).toEqual([peerKey(HASH, V4), peerKey(HASH, V6)]);
    expect(body.peers[keys[0]]).toEqual({
      client: 'qBittorrent/5.1.4', peer_id_client: '-qB5140-', connection: 'BT', country: 'Canada', country_code: 'ca',
      flags: 'D H', flags_desc: 'D = Interested', progress: 0.5, relevance: 1, dl_speed: 1024, up_speed: 0, downloaded: 4096, uploaded: 0,
    });
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('torrents.view');
  });

  it('gives an admin each address as ip:port', async () => {
    mocks.requireUserCapability.mockResolvedValue(user('admin'));
    const body = await (await get()).json();
    expect(Object.values(body.peers).map((entry) => (entry as { address: string }).address)).toEqual([V4, V6]);
    expect(body.peers[peerKey(HASH, V4)]).not.toHaveProperty('ip');
    expect(body.peers[peerKey(HASH, V4)]).not.toHaveProperty('files');
  });

  it('sends what changed since the cursor: changed fields, new peers, and the keys of peers that left', async () => {
    const first = await (await get()).json();
    mocks.client.getTorrentPeers.mockResolvedValue({
      rid: 1, full_update: true, show_flags: true,
      peers: { [V4]: { ...peer('198.51.100.7', 51413), dl_speed: 9 }, '203.0.113.9:1': peer('203.0.113.9', 1) },
    });
    const body = await (await get(`?cursor=${first.cursor}`)).json();
    expect(body).toMatchObject({ fullUpdate: false, removed: [peerKey(HASH, V6)] });
    expect(body.peers[peerKey(HASH, V4)]).toEqual({ dl_speed: 9 });
    expect(body.peers[peerKey(HASH, '203.0.113.9:1')]).toMatchObject({ client: 'qBittorrent/5.1.4' });
    expect(body).not.toHaveProperty('private');
    expectNoAddress(body);
    expect(mocks.client.getTorrents).toHaveBeenCalledTimes(1);
  });

  it('always asks qBittorrent for the full list: its rid is shared by every torrent and user', async () => {
    const first = await (await get()).json();
    await get(`?cursor=${first.cursor}`);
    expect(mocks.client.getTorrentPeers.mock.calls.map((call) => call.slice(0, 1))).toEqual([[HASH], [HASH]]);
  });

  it('never diffs against another user’s, another torrent’s or another view’s list', async () => {
    const memberFirst = await (await get()).json();
    // An admin polling the same torrent, and the same member's cursor on another torrent.
    mocks.requireUserCapability.mockResolvedValue(user('admin'));
    const adminBody = await (await get(`?cursor=${memberFirst.cursor}`)).json();
    expect(adminBody.fullUpdate).toBe(true);
    mocks.requireUserCapability.mockResolvedValue(user('member'));
    const OTHER = 'b'.repeat(40);
    const other = await (await GET(new NextRequest(`http://localhost/api/qbittorrent/${OTHER}/peers?cursor=${memberFirst.cursor}`), { params: Promise.resolve({ hash: OTHER }) })).json();
    expect(other.fullUpdate).toBe(true);
  });

  it.each(['abc', 'f'.repeat(64), '../x'])('sends the full list for an unknown cursor %j', async (cursor) => {
    const body = await (await get(`?cursor=${encodeURIComponent(cursor)}`)).json();
    expect(body.fullUpdate).toBe(true);
    expect(Object.keys(body.peers)).toHaveLength(2);
  });

  it('keys the same peer differently on another torrent', () => {
    expect(peerKey(HASH, V4)).not.toBe(peerKey('b'.repeat(40), V4));
  });

  it('refuses without torrents.view, and anything but one info hash', async () => {
    mocks.requireUserCapability.mockResolvedValue(forbidden());
    expect((await get()).status).toBe(403);
    mocks.requireUserCapability.mockResolvedValue(user('admin'));
    const res = await GET(new NextRequest('http://localhost/api/qbittorrent/all/peers'), { params: Promise.resolve({ hash: 'all' }) });
    expect(res.status).toBe(400);
    expect(mocks.client.getTorrentPeers).not.toHaveBeenCalled();
  });
});

describe('POST /api/qbittorrent/[hash]/peers (add)', () => {
  it('needs torrents.manage', async () => {
    mocks.requireUserCapability.mockResolvedValue(forbidden());
    expect((await post({ peers: [V4] })).status).toBe(403);
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('torrents.manage');
    expect(mocks.client.addPeers).not.toHaveBeenCalled();
  });

  it.each([true, undefined])('keeps a member from adding peers to a private torrent (private: %j)', async (flag) => {
    mocks.requireUserCapability.mockResolvedValue(user('member'));
    mocks.client.getTorrents.mockResolvedValue([{ hash: HASH, private: flag }]);
    const res = await post({ peers: [V4] });
    expect(res.status).toBe(403);
    expect(mocks.client.addPeers).not.toHaveBeenCalled();
  });

  it('lets an admin add peers to a private torrent', async () => {
    mocks.requireUserCapability.mockResolvedValue(user('admin'));
    mocks.client.getTorrents.mockResolvedValue([{ hash: HASH, private: true }]);
    expect((await post({ peers: [V4] })).status).toBe(200);
    expect(mocks.client.addPeers).toHaveBeenCalledWith(HASH, [V4]);
  });

  it('answers 404 when qBittorrent doesn’t have the torrent', async () => {
    mocks.client.getTorrents.mockResolvedValue([]);
    expect((await post({ peers: [V4] })).status).toBe(404);
    mocks.requireUserCapability.mockResolvedValue(user('admin'));
    mocks.client.addPeers.mockResolvedValue('missing');
    expect((await post({ peers: [V4] })).status).toBe(404);
  });

  it('sends IPv4 and bracketed IPv6 peers once each, in qBittorrent’s form', async () => {
    const res = await post({ peers: [` ${V4} `, '[2001:DB8::7]:6881', V4, ''] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ requested: 2, added: 1, failed: 0 });
    expect(mocks.client.addPeers).toHaveBeenCalledWith(HASH, [V4, V6]);
  });

  it.each([
    [['198.51.100.7']],
    [['198.51.100.7:0']],
    [['198.51.100.7:65536']],
    [['198.51.100.07:80']],
    [['2001:db8::7:6881']],
    [['[198.51.100.7]:6881']],
    [['[fe80::1%eth0]:6881']],
    [['host.example:6881']],
    [['127.0.0.1:6881']],
    [['0.0.0.0:6881']],
    [['239.1.1.1:6881']],
    [['255.255.255.255:6881']],
    [['[::1]:6881']],
    [['[::]:6881']],
    [['[ff02::1]:6881']],
    [['[::ffff:127.0.0.1]:6881']],
    [Array.from({ length: 201 }, () => '')],
    [['198.51.100.7:6881|203.0.113.1:6881']],
    [[`${'1'.repeat(70)}:1`]],
    [[42]],
    [[]],
    ['198.51.100.7:6881'],
    [Array.from({ length: 51 }, (_, i) => `198.51.100.${i}:6881`)],
  ])('refuses %j', async (peers) => {
    const res = await post({ peers });
    expect(res.status).toBe(400);
    expect(mocks.client.addPeers).not.toHaveBeenCalled();
  });

  it.each([
    ['127.0.0.1:5948', 'Can’t add 127.0.0.1:5948: a loopback address is qBittorrent’s own computer, not a peer.'],
    ['[::1]:22', 'Can’t add [::1]:22: a loopback address is qBittorrent’s own computer, not a peer.'],
    ['[::ffff:127.0.0.1]:22', 'Can’t add [::ffff:127.0.0.1]:22: a loopback address is qBittorrent’s own computer, not a peer.'],
    ['0.0.0.0:6881', 'Can’t add 0.0.0.0:6881: an unspecified address is not a peer’s.'],
    ['239.1.1.1:6881', 'Can’t add 239.1.1.1:6881: a multicast or broadcast address is not one peer’s.'],
    ['host.example:6881', 'Not an IP:port: host.example:6881. Write IPv6 as [address]:port.'],
  ])('says why %s is refused', async (peer, error) => {
    // A loopback peer was refused as "Not an IP:port", which it is.
    const res = await post({ peers: [peer] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
  });
});

describe('POST /api/qbittorrent/[hash]/peers/ban', () => {
  it('is an admin’s only', async () => {
    mocks.requireAdmin.mockResolvedValue(forbidden());
    expect((await ban({ key: peerKey(HASH, V4) })).status).toBe(403);
    expect(mocks.client.getTorrentPeers).not.toHaveBeenCalled();
    expect(mocks.client.banPeers).not.toHaveBeenCalled();
  });

  it('bans the address qBittorrent lists under the key, not one the browser sends, and audits it without the address', async () => {
    const res = await ban({ key: peerKey(HASH, V6), address: '203.0.113.99:1', peers: '203.0.113.99:1' });
    expect(res.status).toBe(200);
    expect(mocks.client.getTorrentPeers).toHaveBeenCalledWith(HASH, expect.anything());
    expect(mocks.client.banPeers).toHaveBeenCalledWith([V6]);
    expect(mocks.recordSettingsUpdated).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'admin-1' }), 'qBittorrent banned peers', ['banned_IPs'], HASH);
    expect(JSON.stringify(mocks.recordSettingsUpdated.mock.calls)).not.toContain('2001:db8');
  });

  it('refuses a peer that has left, or a raw address in place of a key', async () => {
    mocks.client.getTorrentPeers.mockResolvedValue({ rid: 2, full_update: true, peers: { [V4]: peer('198.51.100.7', 51413) } });
    expect((await ban({ key: peerKey(HASH, V6) })).status).toBe(409);
    expect((await ban({ key: V4 })).status).toBe(400);
    expect((await ban({})).status).toBe(400);
    expect(mocks.client.banPeers).not.toHaveBeenCalled();
    expect(mocks.recordSettingsUpdated).not.toHaveBeenCalled();
  });
});
