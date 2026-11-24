import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { NextResponse } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QBittorrentClient } from '@/lib/qbittorrent-client';

const mocks = vi.hoisted(() => ({
  requireUserCapability: vi.fn(),
  getQBittorrentClient: vi.fn(),
  cache: new Map<string, unknown>(),
}));
vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.requireUserCapability }));
vi.mock('@/lib/service-helpers', () => ({ getQBittorrentClient: mocks.getQBittorrentClient }));
vi.mock('@/lib/cache/qbittorrent-version', () => ({ getQbitCacheVersion: vi.fn().mockResolvedValue(3) }));
vi.mock('@/lib/cache/json-cache', () => ({
  getCachedJson: vi.fn(async (scope: string, seed: string) => mocks.cache.get(`${scope}:${seed}`) ?? null),
  setCachedJson: vi.fn(async (scope: string, seed: string, value: unknown) => { mocks.cache.set(`${scope}:${seed}`, value); }),
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));

import { GET } from '@/app/api/qbittorrent/transfer/stats/route';

const get = GET as unknown as () => Promise<Response>;
const PASSKEY = 'https://tracker.example/announce?passkey=SECRETPASSKEY';

// A stand-in qBittorrent answering sync/maindata as 5.1.4 does.
describe('qBittorrent server stats', () => {
  let server: http.Server;
  let client: QBittorrentClient;
  let requests: string[];
  let maindata: unknown;
  let shareBody: Record<string, string> | null;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        if (req.url === '/api/v2/auth/login') {
          res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': 'SID=abc; path=/' });
          return res.end('Ok.');
        }
        requests.push(req.url!);
        if (req.url === '/api/v2/torrents/setShareLimits') shareBody = Object.fromEntries(new URLSearchParams(raw));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(req.url!.startsWith('/api/v2/sync/maindata') ? JSON.stringify(maindata) : '');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    client = new QBittorrentClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'pw', 'admin');
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cache.clear();
    requests = [];
    shareBody = null;
    mocks.requireUserCapability.mockResolvedValue({ ok: true, user: { id: 'u1' }, session: {} });
    mocks.getQBittorrentClient.mockResolvedValue(client);
    maindata = {
      full_update: true,
      rid: 1,
      server_state: {
        alltime_dl: 1_876_000, alltime_ul: 2_688_000, free_space_on_disk: 52_000_000_000, global_ratio: '1.43',
        last_external_address_v4: '203.0.113.9', dl_info_data: 5, connection_status: 'connected',
      },
      torrents: { abc: { name: 'Release', magnet_uri: `magnet:?xt=urn:btih:abc&tr=${encodeURIComponent(PASSKEY)}`, tracker: PASSKEY } },
      trackers: { [PASSKEY]: ['abc'] },
    };
  });

  it('asks for a full update and keeps only the four stats', async () => {
    await expect(client.getServerStats()).resolves.toEqual({
      freeSpaceOnDisk: 52_000_000_000,
      alltimeDownloaded: 1_876_000,
      alltimeUploaded: 2_688_000,
      globalRatio: 1.43,
    });
    expect(requests).toEqual(['/api/v2/sync/maindata?rid=0']);
  });

  it("reports what qBittorrent can't tell as null", async () => {
    // -1 is qBittorrent's "unknown" (the save folder is missing, say).
    maindata = { server_state: { free_space_on_disk: -1, alltime_dl: 'x', global_ratio: '' } };
    await expect(client.getServerStats()).resolves.toEqual({
      freeSpaceOnDisk: null, alltimeDownloaded: null, alltimeUploaded: null, globalRatio: null,
    });
  });

  it('refuses an answer without server_state', async () => {
    maindata = { rid: 2 };
    await expect(client.getServerStats()).rejects.toThrow();
  });

  it('sends all three share limits', async () => {
    await client.setShareLimits('aaa|bbb', 1.5, 120, -2);
    expect(shareBody).toEqual({ hashes: 'aaa|bbb', ratioLimit: '1.5', seedingTimeLimit: '120', inactiveSeedingTimeLimit: '-2' });
  });

  it('the route returns the stats, never a torrent or tracker, and reuses a recent read', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ freeSpaceOnDisk: 52_000_000_000, alltimeDownloaded: 1_876_000, alltimeUploaded: 2_688_000, globalRatio: 1.43 });
    expect(body).not.toContain('SECRETPASSKEY');
    expect(body).not.toContain('203.0.113.9');
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('torrents.view');

    expect((await get()).status).toBe(200);
    expect(requests).toEqual(['/api/v2/sync/maindata?rid=0']);
  });

  it('the route reads nothing for a user without torrents.view', async () => {
    mocks.requireUserCapability.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
    expect((await get()).status).toBe(403);
    expect(mocks.getQBittorrentClient).not.toHaveBeenCalled();
    expect(requests).toEqual([]);
  });

  it('the route fails without caching when qBittorrent answers oddly', async () => {
    maindata = 'Forbidden';
    expect((await get()).status).toBe(500);
    expect(mocks.cache.size).toBe(0);
  });
});
