import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QBittorrentClient } from '@/lib/qbittorrent-client';
import { resetQBittorrentSyncForTests } from '@/lib/qbittorrent-sync';

/*
 * qBittorrent's transfer/info carries its last external IPv4 and IPv6 address:
 * the owner's public IP. The torrents toolbar, the widget and Settings poll it
 * through Helprr for anyone who may view torrents, so every route that passes
 * it on keeps only the figures those screens show, for members and admins alike.
 * A stand-in qBittorrent answers as 5.1.4 does, through the real client.
 */

const PUBLIC_V4 = '203.0.113.77';
const PUBLIC_V6 = '2001:db8::77';
const WEB_UI_PASSWORD = 'web-ui-secret';
const PROXY_PASSWORD = 'proxy-secret';
const SHOWN_TRANSFER_FIELDS = [
  'connection_status', 'dht_nodes', 'dl_info_data', 'dl_info_speed', 'dl_rate_limit', 'up_info_data', 'up_info_speed', 'up_rate_limit',
];

const mocks = vi.hoisted(() => ({
  requireUserCapability: vi.fn(),
  getQBittorrentClient: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ requireUser: vi.fn(), requireUserCapability: mocks.requireUserCapability }));
vi.mock('@/lib/service-helpers', () => ({ getQBittorrentClient: mocks.getQBittorrentClient }));
vi.mock('@/lib/cache/qbittorrent-version', () => ({ getQbitCacheVersion: vi.fn(async () => 1) }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/server-perf', () => ({ logApiDuration: vi.fn() }));

import { GET as getSummary } from '@/app/api/qbittorrent/summary/route';
import { GET as getTransfer } from '@/app/api/qbittorrent/transfer/route';
import { GET as getCategories } from '@/app/api/qbittorrent/categories/route';

const transferInfo = {
  connection_status: 'connected', dht_nodes: 105, dl_info_data: 10, dl_info_speed: 2, dl_rate_limit: 0,
  last_external_address_v4: PUBLIC_V4, last_external_address_v6: PUBLIC_V6,
  up_info_data: 20, up_info_speed: 1, up_rate_limit: 0,
};
const PREFERENCES: Record<string, unknown> = {
  use_subcategories: false, auto_tmm_enabled: false, use_category_paths_in_manual_mode: true,
  category_changed_tmm_enabled: false, save_path_changed_tmm_enabled: false, torrent_changed_tmm_enabled: true,
  web_ui_password: WEB_UI_PASSWORD, proxy_password: PROXY_PASSWORD, web_ui_username: 'admin', announce_ip: PUBLIC_V4,
};
const torrent = {
  hash: 'aaaabbbbccccddddeeeeffff0000111122223333', name: 'Some.Show.S01', size: 1, progress: 0.5, state: 'downloading',
  category: '', tags: '', dlspeed: 2, upspeed: 1, magnet_uri: 'magnet:?xt=urn:btih:aaaa', tracker: '',
};

function signInAs(role: 'admin' | 'member') {
  mocks.requireUserCapability.mockResolvedValue({ ok: true, user: { id: `${role}-1`, role }, session: {} });
}

/** Every response body a browser gets, as text, for a search that can't miss a nested copy. */
async function bodyOf(response: Response): Promise<{ text: string; json: Record<string, unknown> }> {
  const text = await response.text();
  return { text, json: JSON.parse(text) };
}

function expectNoAddress(text: string) {
  expect(text).not.toContain(PUBLIC_V4);
  expect(text).not.toContain(PUBLIC_V6);
  expect(text).not.toContain('last_external_address');
}

describe('qBittorrent transfer info and preferences reach a browser field by field', () => {
  let server: http.Server;
  let client: QBittorrentClient;
  let preferences = PREFERENCES;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/api/v2/auth/login') {
        res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': 'SID=abc; path=/' });
        res.end('Ok.');
        return;
      }
      const path = req.url!.split('?')[0];
      const answers: Record<string, unknown> = {
        '/api/v2/transfer/info': transferInfo,
        '/api/v2/transfer/speedLimitsMode': 0,
        '/api/v2/torrents/info': [torrent],
        // The summary's one read: server_state carries the same address, and more.
        '/api/v2/sync/maindata': {
          rid: 1,
          full_update: true,
          torrents: { [torrent.hash]: { ...torrent, hash: undefined } },
          server_state: { ...transferInfo, use_alt_speed_limits: false, alltime_dl: 1, free_space_on_disk: 1, queueing: true },
          trackers: {},
        },
        '/api/v2/app/preferences': preferences,
        '/api/v2/app/defaultSavePath': '/downloads',
        '/api/v2/torrents/categories': { tv: { name: 'tv', savePath: '/downloads/tv' } },
      };
      if (!(path in answers)) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(answers[path]));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    client = new QBittorrentClient(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, 'pw', 'admin');
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getQBittorrentClient.mockResolvedValue(client);
    resetQBittorrentSyncForTests();
    preferences = PREFERENCES;
  });

  describe.each(['member', 'admin'] as const)('as %s', (role) => {
    beforeEach(() => signInAs(role));

    it.each([
      ['the full summary', ''],
      ['the delta', '?view=delta'],
      ['the counters', '?view=counters'],
    ])('%s carries the shown transfer figures only', async (_label, query) => {
      const { text, json } = await bodyOf(await getSummary(new NextRequest(`http://localhost/api/qbittorrent/summary${query}`)));
      expectNoAddress(text);
      expect(Object.keys(json.transferInfo as object).sort()).toEqual(SHOWN_TRANSFER_FIELDS);
      expect(json.transferInfo).toEqual(expect.objectContaining({ dl_info_speed: 2, dht_nodes: 105, connection_status: 'connected' }));
    });

    it('the delta after a first poll carries no address either', async () => {
      const first = await bodyOf(await getSummary(new NextRequest('http://localhost/api/qbittorrent/summary?view=delta')));
      const cursor = (first.json as { cursor: string }).cursor;
      const { text } = await bodyOf(await getSummary(new NextRequest(`http://localhost/api/qbittorrent/summary?view=delta&cursor=${cursor}`)));
      expectNoAddress(text);
    });

    it('the transfer route carries the shown transfer figures only', async () => {
      const { text, json } = await bodyOf(await getTransfer(new NextRequest('http://localhost/api/qbittorrent/transfer')));
      expectNoAddress(text);
      expect(Object.keys(json).sort()).toEqual(SHOWN_TRANSFER_FIELDS);
    });

    it('the category details carry four save-path settings, none of the other preferences', async () => {
      const { text, json } = await bodyOf(await getCategories(new NextRequest('http://localhost/api/qbittorrent/categories?details=1')));
      expect(text).not.toContain(WEB_UI_PASSWORD);
      expect(text).not.toContain(PROXY_PASSWORD);
      expectNoAddress(text);
      expect(json).toEqual({
        categories: { tv: { name: 'tv', savePath: '/downloads/tv' } },
        defaultSavePath: '/downloads',
        subcategories: false,
        autoTmmByDefault: false,
        categoryPathsInManualMode: true,
        relocateOnCategoryPathChange: false,
      });
    });
  });

  it("reads null for a setting an older qBittorrent doesn't send", async () => {
    preferences = { ...PREFERENCES };
    delete preferences.category_changed_tmm_enabled;
    await expect(client.getSavePathPreferences()).resolves.toEqual({
      subcategories: false, autoTmmByDefault: false, categoryPathsInManualMode: true, relocateOnCategoryPathChange: null,
    });
  });
});
