import { NextRequest, NextResponse } from 'next/server';
import { AxiosError, AxiosHeaders } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * POST /api/qbittorrent/[hash]/trackers: a member with torrents.manage edits
 * and removes trackers by their place in the list, so the full announce URL
 * (with its passkey) stays on the server, both ways.
 */

const KEY = '0123456789abcdef0123456789abcdef';
const HASH = 'aaaabbbbccccddddeeeeffff0000111122223333';
const ANNOUNCE = `https://tracker.invalid/announce/${KEY}`;
const PUBLIC = 'udp://public.invalid:1337/announce';

const mocks = vi.hoisted(() => ({
  requireUserCapability: vi.fn(),
  bump: vi.fn(),
  client: {
    getTorrentTrackers: vi.fn(),
    addTrackers: vi.fn(),
    editTracker: vi.fn(),
    removeTrackers: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.requireUserCapability }));
vi.mock('@/lib/service-helpers', () => ({ getQBittorrentClient: vi.fn(async () => mocks.client) }));
vi.mock('@/lib/cache/qbittorrent-version', () => ({ bumpQbitCacheVersion: mocks.bump }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/server-perf', () => ({ logApiDuration: vi.fn() }));

import { POST } from '@/app/api/qbittorrent/[hash]/trackers/route';

const tracker = (url: string, tier: number) => ({
  url, status: 2, tier, num_peers: 0, num_seeds: 0, num_leeches: 0, num_downloaded: 0, msg: tier >= 0 ? `Bad passkey ${KEY}` : '',
});
const LIST = [tracker('** [DHT] **', -1), tracker('** [PeX] **', -1), tracker('** [LSD] **', -1), tracker(ANNOUNCE, 0), tracker(PUBLIC, 1)];

function signInAs(role: 'admin' | 'member') {
  mocks.requireUserCapability.mockResolvedValue({ ok: true, user: { id: `${role}-1`, role }, session: {} });
}

const post = (body: unknown, hash = HASH) =>
  POST(
    new NextRequest(`http://localhost/api/qbittorrent/${hash}/trackers`, { method: 'POST', body: JSON.stringify(body) }),
    { params: Promise.resolve({ hash }) },
  );

const noUpstreamChange = () => {
  expect(mocks.client.addTrackers).not.toHaveBeenCalled();
  expect(mocks.client.editTracker).not.toHaveBeenCalled();
  expect(mocks.client.removeTrackers).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.clearAllMocks();
  signInAs('member');
  mocks.client.getTorrentTrackers.mockResolvedValue(LIST);
});

describe('authorization', () => {
  it('needs torrents.manage and changes nothing without it', async () => {
    mocks.requireUserCapability.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
    const res = await post({ action: 'remove', index: 3, shown: 'https://tracker.invalid', count: 5 });
    expect(res.status).toBe(403);
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('torrents.manage');
    expect(mocks.client.getTorrentTrackers).not.toHaveBeenCalled();
    noUpstreamChange();
  });

  it('refuses qBittorrent’s `all` and `|` lists in place of one hash', async () => {
    for (const hash of ['all', `${HASH}|${HASH}`]) {
      expect((await post({ action: 'add', urls: [PUBLIC] }, hash)).status).toBe(400);
    }
    noUpstreamChange();
  });

  it('refuses an unknown action', async () => {
    expect((await post({ action: 'replaceAll', urls: [PUBLIC] })).status).toBe(400);
    noUpstreamChange();
  });
});

describe('edit and remove by place', () => {
  it('lets a member remove a private tracker it was shown only by host', async () => {
    const res = await post({ action: 'remove', index: 3, shown: 'https://tracker.invalid', count: 5 });
    expect(res.status).toBe(200);
    expect(mocks.client.removeTrackers).toHaveBeenCalledWith(HASH, [ANNOUNCE]);
    expect(mocks.bump).toHaveBeenCalled();
  });

  it('lets a member edit a private tracker to the full URL it typed', async () => {
    const res = await post({ action: 'edit', index: 3, shown: 'https://tracker.invalid', count: 5, url: 'https://new.invalid/announce/abc123def456' });
    expect(res.status).toBe(200);
    expect(mocks.client.editTracker).toHaveBeenCalledWith(HASH, ANNOUNCE, 'https://new.invalid/announce/abc123def456');
  });

  it('matches an admin on the full URL it was shown', async () => {
    signInAs('admin');
    expect((await post({ action: 'remove', index: 3, shown: 'https://tracker.invalid', count: 5 })).status).toBe(409);
    expect((await post({ action: 'remove', index: 3, shown: ANNOUNCE, count: 5 })).status).toBe(200);
    expect(mocks.client.removeTrackers).toHaveBeenCalledTimes(1);
  });

  it('refuses a place whose tracker moved (the list was reordered)', async () => {
    mocks.client.getTorrentTrackers.mockResolvedValue([LIST[0], LIST[1], LIST[2], LIST[4], LIST[3]]);
    const res = await post({ action: 'remove', index: 3, shown: 'https://tracker.invalid', count: 5 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/changed/) });
    noUpstreamChange();
  });

  it('refuses when the list grew or shrank, even if the host at that place still matches', async () => {
    mocks.client.getTorrentTrackers.mockResolvedValue([...LIST, tracker('https://tracker.invalid/announce/other', 2)]);
    expect((await post({ action: 'remove', index: 3, shown: 'https://tracker.invalid', count: 5 })).status).toBe(409);
    mocks.client.getTorrentTrackers.mockResolvedValue(LIST.slice(0, 4));
    expect((await post({ action: 'edit', index: 4, shown: 'udp://public.invalid:1337', count: 5, url: PUBLIC })).status).toBe(409);
    noUpstreamChange();
  });

  it('refuses DHT, PeX and LSD', async () => {
    const res = await post({ action: 'remove', index: 0, shown: '** [DHT] **', count: 5 });
    expect(res.status).toBe(400);
    noUpstreamChange();
  });

  it('refuses a place outside the list or a malformed reference', async () => {
    for (const ref of [
      { index: 9, shown: 'x', count: 10 },
      { index: -1, shown: 'x', count: 5 },
      { index: 1.5, shown: 'x', count: 5 },
      { index: '3', shown: 'https://tracker.invalid', count: 5 },
      { index: 3, count: 5 },
      { index: 3, shown: 'https://tracker.invalid' },
    ]) {
      const res = await post({ action: 'remove', ...ref });
      expect([400, 409]).toContain(res.status);
    }
    noUpstreamChange();
  });

  it('refuses to remove a URL with a | (qBittorrent would read it as other URLs)', async () => {
    mocks.client.getTorrentTrackers.mockResolvedValue([tracker('https://a.invalid/x|https://b.invalid/y', 0)]);
    signInAs('admin');
    expect((await post({ action: 'remove', index: 0, shown: 'https://a.invalid/x|https://b.invalid/y', count: 1 })).status).toBe(409);
    noUpstreamChange();
  });

  it('says so when the new URL is already on the torrent, without echoing qBittorrent', async () => {
    mocks.client.editTracker.mockRejectedValue(new AxiosError('409', 'ERR_BAD_REQUEST', undefined, undefined, {
      status: 409, statusText: 'Conflict', data: 'New tracker URL already exists', headers: {}, config: { headers: new AxiosHeaders() },
    }));
    const res = await post({ action: 'edit', index: 4, shown: 'udp://public.invalid:1337', count: 5, url: 'https://a.invalid/announce' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'That tracker is already on this torrent' });
    expect(mocks.bump).not.toHaveBeenCalled();
  });
});

describe('URL validation', () => {
  it('refuses a newline, tab or other whitespace that would add more entries', async () => {
    for (const url of [
      `${PUBLIC}\nhttps://evil.invalid/announce`,
      `${PUBLIC}\r\nhttps://evil.invalid/announce`,
      `${PUBLIC} https://evil.invalid/announce`,
      'https://a.invalid/an nounce',
      'https://a.invalid/\u0000',
    ]) {
      expect((await post({ action: 'add', urls: [url] })).status).toBe(400);
      expect((await post({ action: 'edit', index: 4, shown: 'udp://public.invalid:1337', count: 5, url })).status).toBe(400);
    }
    noUpstreamChange();
  });

  it('takes http, https, udp and wss only, up to the length cap', async () => {
    for (const url of ['ftp://a.invalid/x', 'javascript:alert(1)', 'magnet:?xt=urn:btih:x', 'not a url', 'https://', `https://a.invalid/${'a'.repeat(2048)}`, '']) {
      expect((await post({ action: 'add', urls: [url] })).status).toBe(400);
    }
    for (const urls of [[], 'https://a.invalid/announce', Array.from({ length: 101 }, (_, i) => `https://t${i}.invalid/announce`)]) {
      expect((await post({ action: 'add', urls })).status).toBe(400);
    }
    noUpstreamChange();
  });

  it('adds valid URLs once each, trimmed, in the order given', async () => {
    const res = await post({ action: 'add', urls: [' https://a.invalid/announce ', 'wss://b.invalid/x', 'https://a.invalid/announce', 'udp://c.invalid:80'] });
    expect(res.status).toBe(200);
    expect(mocks.client.addTrackers).toHaveBeenCalledWith(HASH, ['https://a.invalid/announce', 'wss://b.invalid/x', 'udp://c.invalid:80']);
    expect(mocks.bump).toHaveBeenCalled();
  });

  it('names the bad line of several', async () => {
    const res = await post({ action: 'add', urls: [PUBLIC, 'nope'] });
    expect(await res.json()).toEqual({ error: expect.stringMatching(/^Line 2 /) });
  });
});

describe('the answer', () => {
  it('gives a member the new list by host, with no passkey in it', async () => {
    const res = await post({ action: 'remove', index: 4, shown: 'udp://public.invalid:1337', count: 5 });
    const body = await res.json();
    expect(body.trackers.map((t: { url: string }) => t.url)).toEqual([
      '** [DHT] **', '** [PeX] **', '** [LSD] **', 'https://tracker.invalid', 'udp://public.invalid:1337',
    ]);
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(JSON.stringify(body)).not.toContain('/announce');
  });

  it('gives an admin the full list', async () => {
    signInAs('admin');
    const res = await post({ action: 'add', urls: [PUBLIC] });
    expect((await res.json()).trackers[3].url).toBe(ANNOUNCE);
  });

  it('never sends a member the full URL in a refusal', async () => {
    for (const body of [
      { action: 'remove', index: 3, shown: 'https://wrong.invalid', count: 5 },
      { action: 'edit', index: 3, shown: 'https://tracker.invalid', count: 5, url: 'nope' },
      { action: 'remove', index: 0, shown: '** [DHT] **', count: 5 },
    ]) {
      expect(JSON.stringify(await (await post(body)).json())).not.toContain(KEY);
    }
  });

  it('still succeeds when the list cannot be read back', async () => {
    mocks.client.getTorrentTrackers.mockResolvedValueOnce(LIST).mockRejectedValueOnce(new Error('down'));
    const res = await post({ action: 'remove', index: 3, shown: 'https://tracker.invalid', count: 5 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ trackers: null });
  });
});
