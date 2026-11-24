import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * A private tracker's passkey (in an announce URL's path or query, and in each
 * `tr=` of the magnet) reaches a browser only for an admin. A member with
 * torrents.view gets hosts, state and a magnet without trackers.
 */

const KEY = '0123456789abcdef0123456789abcdef';
const QUERY_KEY = 'deadbeef';
const HASH = 'aaaabbbbccccddddeeeeffff0000111122223333';
const ANNOUNCE = `https://tracker.invalid/announce/${KEY}`;
const ANNOUNCE_QUERY = `http://t.invalid/a?passkey=${QUERY_KEY}`;
const MAGNET = `magnet:?xt=urn:btih:${HASH}&dn=Some.Show.S01&tr=${encodeURIComponent(ANNOUNCE)}&tr=${encodeURIComponent(ANNOUNCE_QUERY)}`;

const mocks = vi.hoisted(() => ({
  requireUserCapability: vi.fn(),
  client: {
    getTorrents: vi.fn(),
    getTorrentProperties: vi.fn(),
    getTorrentFiles: vi.fn(),
    getTorrentTrackers: vi.fn(),
    getTransferInfo: vi.fn(),
    getSpeedLimitsMode: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  requireUser: vi.fn(),
  requireUserCapability: mocks.requireUserCapability,
}));
vi.mock('@/lib/service-helpers', () => ({
  getQBittorrentClient: vi.fn(async () => mocks.client),
}));
vi.mock('@/lib/file-audit', () => ({ deleteTorrentsAudited: vi.fn(), TORRENT_DELETE_REFUSALS: {} }));
vi.mock('@/lib/cache/qbittorrent-version', () => ({ bumpQbitCacheVersion: vi.fn(), getQbitCacheVersion: vi.fn(async () => 1) }));
vi.mock('@/lib/cache/json-cache', () => ({ getCachedJson: vi.fn(async () => null), setCachedJson: vi.fn() }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/server-perf', () => ({ logApiDuration: vi.fn() }));

import { GET as getDetails } from '@/app/api/qbittorrent/[hash]/details/route';
import { GET as getList } from '@/app/api/qbittorrent/route';
import { GET as getSummary } from '@/app/api/qbittorrent/summary/route';

const torrentInfo = {
  hash: HASH, name: 'Some.Show.S01', size: 1, progress: 1, state: 'uploading', category: '', tags: '',
  magnet_uri: MAGNET, tracker: ANNOUNCE, comment: `Details: ${ANNOUNCE}`, private: true,
};

function signInAs(role: 'admin' | 'member') {
  mocks.requireUserCapability.mockResolvedValue({ ok: true, user: { id: `${role}-1`, role }, session: {} });
}

const details = () => getDetails(new NextRequest(`http://localhost/api/qbittorrent/${HASH}/details`), { params: Promise.resolve({ hash: HASH }) });

beforeEach(() => {
  vi.clearAllMocks();
  signInAs('member');
  mocks.client.getTorrents.mockResolvedValue([torrentInfo]);
  mocks.client.getTorrentProperties.mockResolvedValue({ save_path: '/data', total_size: 1, seeds: 2, comment: `Details: ${ANNOUNCE}` });
  mocks.client.getTorrentFiles.mockResolvedValue([{ index: 0, name: 'a.mkv', size: 1, progress: 1, priority: 1, is_seed: true, availability: 1 }]);
  mocks.client.getTorrentTrackers.mockResolvedValue([
    { url: '** [DHT] **', status: 2, tier: -1, num_peers: 0, num_seeds: 0, num_leeches: 0, num_downloaded: 0, msg: '' },
    { url: ANNOUNCE, status: 4, tier: 0, num_peers: 1, num_seeds: 2, num_leeches: 3, num_downloaded: 4, msg: `Passkey ${KEY} not found` },
    { url: ANNOUNCE_QUERY, status: 2, tier: 1, num_peers: 1, num_seeds: 2, num_leeches: 3, num_downloaded: 4, msg: '' },
  ]);
  mocks.client.getTransferInfo.mockResolvedValue({ dl_info_speed: 0, dl_info_data: 0, up_info_speed: 0, up_info_data: 0, dl_rate_limit: 0, up_rate_limit: 0, dht_nodes: 0, connection_status: 'connected' });
  mocks.client.getSpeedLimitsMode.mockResolvedValue(0);
});

function expectNoPasskey(body: unknown) {
  const json = JSON.stringify(body);
  expect(json).not.toContain(KEY);
  expect(json).not.toContain(QUERY_KEY);
  expect(json).not.toContain('tr=');
}

describe('GET /api/qbittorrent/[hash]/details', () => {
  it('gives a member tracker hosts, their state and a magnet without trackers', async () => {
    const res = await details();
    expect(res.status).toBe(200);
    const body = await res.json();
    expectNoPasskey(body);
    expect(body.trackers.map((tracker: { url: string }) => tracker.url)).toEqual(['** [DHT] **', 'https://tracker.invalid', 'http://t.invalid']);
    expect(body.trackers[1]).toMatchObject({ status: 4, tier: 0, num_seeds: 2, num_leeches: 3, msg: 'Passkey [REDACTED] not found' });
    expect(body.magnet).toBe(`magnet:?xt=urn:btih:${HASH}&dn=Some.Show.S01`);
    expect(body.files).toHaveLength(1);
    expect(body.properties).toMatchObject({ save_path: '/data', total_size: 1, seeds: 2 });
  });

  it('gives an admin the full announce URLs and magnet', async () => {
    signInAs('admin');
    const body = await (await details()).json();
    expect(body.trackers.map((tracker: { url: string }) => tracker.url)).toEqual(['** [DHT] **', ANNOUNCE, ANNOUNCE_QUERY]);
    expect(body.trackers[1].msg).toBe(`Passkey ${KEY} not found`);
    expect(body.magnet).toBe(MAGNET);
  });

  it("leaves out the torrent's comment, which the drawer does not show, for everyone", async () => {
    signInAs('admin');
    const body = await (await details()).json();
    expect(body.properties).not.toHaveProperty('comment');
  });

  it('has no magnet to copy when qBittorrent no longer lists the torrent', async () => {
    mocks.client.getTorrents.mockResolvedValue([]);
    expect((await (await details()).json()).magnet).toBeNull();
  });

  it("refuses anything but one info hash, so qBittorrent's `all` cannot list every torrent", async () => {
    const res = await getDetails(new NextRequest('http://localhost/api/qbittorrent/all/details'), { params: Promise.resolve({ hash: 'all' }) });
    expect(res.status).toBe(400);
    expect(mocks.client.getTorrents).not.toHaveBeenCalled();
  });

  it('still shows the details when the magnet lookup fails', async () => {
    mocks.client.getTorrents.mockRejectedValue(new Error('timeout'));
    const res = await details();
    expect(res.status).toBe(200);
    expect((await res.json()).magnet).toBeNull();
  });

  it('checks torrents.view before asking qBittorrent', async () => {
    mocks.requireUserCapability.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
    expect((await details()).status).toBe(403);
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('torrents.view');
    expect(mocks.client.getTorrentTrackers).not.toHaveBeenCalled();
  });
});

describe('torrent lists', () => {
  it.each(['admin', 'member'] as const)('GET /api/qbittorrent sends no magnet or tracker URL (%s)', async (role) => {
    signInAs(role);
    const body = await (await getList(new NextRequest(`http://localhost/api/qbittorrent?hashes=${HASH}`))).json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ hash: HASH, name: 'Some.Show.S01' });
    expect(body[0]).not.toHaveProperty('magnet_uri');
    expect(body[0]).not.toHaveProperty('tracker');
    expect(body[0]).not.toHaveProperty('comment');
    expectNoPasskey(body);
  });

  it.each(['', '?view=delta', '?view=counters'])('GET /api/qbittorrent/summary%s sends no magnet or tracker URL', async (query) => {
    const res = await getSummary(new NextRequest(`http://localhost/api/qbittorrent/summary${query}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expectNoPasskey(body);
    expect(JSON.stringify(body)).not.toContain('tracker.invalid');
  });
});
