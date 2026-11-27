import { createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  fetchTorrentLink: vi.fn(),
  qbit: {
    getTorrents: vi.fn(),
    addMagnet: vi.fn(),
    addTorrentFile: vi.fn(),
    getDefaultSavePath: vi.fn(),
    getCategories: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser, requireUserCapability: vi.fn() }));
vi.mock('@/lib/service-helpers', () => ({ getQBittorrentClient: vi.fn().mockResolvedValue(mocks.qbit) }));
vi.mock('@/lib/file-audit', () => ({ deleteTorrentsAudited: vi.fn(), TORRENT_DELETE_REFUSALS: {} }));
vi.mock('@/lib/cache/qbittorrent-version', () => ({ bumpQbitCacheVersion: vi.fn() }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
// The fetch itself is torrent-link-fetch.test.ts's; the URL checks stay real here.
vi.mock('@/lib/torrent-link-fetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/torrent-link-fetch')>()),
  fetchTorrentLink: mocks.fetchTorrentLink,
}));

import { POST } from '@/app/api/qbittorrent/route';
import { BLOCKED_LINK_MESSAGE, PRIVATE_LINK_MESSAGE, TorrentLinkError } from '@/lib/torrent-link-fetch';

const hashOf = (n: number) => String(n).repeat(40).slice(0, 40);
const magnetOf = (n: number) => `magnet:?xt=urn:btih:${hashOf(n)}&dn=Test${n}`;
function torrentOf(name: string) {
  const info = `d4:name${name.length}:${name}12:piece lengthi16384ee`;
  return { bytes: new TextEncoder().encode(`d8:announce4:http4:info${info}e`), hash: createHash('sha1').update(info).digest('hex') };
}

const ADMIN = { id: 'u1', role: 'admin', template: 'admin', permissions: {} };
const MEMBER = { id: 'u2', role: 'member', template: 'member', permissions: { 'torrents.add': true } };
const VIEWER = { id: 'u3', role: 'member', template: 'member', permissions: { 'torrents.add': false } };

/** qBittorrent's torrents list: what it already has, plus what was added (as qBittorrent lists it). */
let have: Set<string>;
function list(...args: unknown[]) {
  const asked = String(args[4] ?? '').split('|');
  return Promise.resolve(asked.filter((hash) => have.has(hash)).map((hash) => ({ hash, name: `Name ${hash.slice(0, 4)}` })));
}

function addLinks(urls: string, body: Record<string, unknown> = {}) {
  return POST(new NextRequest('http://localhost/api/qbittorrent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ urls, ...body }),
  }));
}

function addFiles(files: Array<{ name: string; bytes: Uint8Array }>, fields: Record<string, string> = {}) {
  const form = new FormData();
  for (const file of files) form.append('file', new File([file.bytes as BlobPart], file.name, { type: 'application/x-bittorrent' }));
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return POST(new NextRequest('http://localhost/api/qbittorrent', { method: 'POST', body: form }));
}

beforeEach(() => {
  vi.clearAllMocks();
  have = new Set();
  mocks.requireUser.mockResolvedValue({ ok: true, user: ADMIN, session: {} });
  mocks.qbit.getDefaultSavePath.mockResolvedValue('/downloads');
  mocks.qbit.getCategories.mockResolvedValue({});
  mocks.qbit.getTorrents.mockImplementation(list);
  mocks.qbit.addMagnet.mockImplementation(async (magnet: string) => {
    have.add(/btih:([0-9a-f]{40})/.exec(magnet)![1]);
    return 'Ok.';
  });
  mocks.qbit.addTorrentFile.mockImplementation(async (bytes: Uint8Array) => {
    const text = new TextDecoder().decode(bytes);
    have.add(createHash('sha1').update(text.slice(text.indexOf('4:info') + 6, -1)).digest('hex'));
  });
});

describe('adding several magnets and links at once', () => {
  it('reports each line: added, already there, or failed with the reason', async () => {
    have.add(hashOf(2));
    const linked = torrentOf('Linked');
    mocks.fetchTorrentLink
      .mockResolvedValueOnce({ kind: 'file', bytes: linked.bytes })
      .mockRejectedValueOnce(new TorrentLinkError('The link answered HTTP 404'));

    const res = await addLinks([
      magnetOf(1),
      '',
      magnetOf(2),
      'https://example.org/a.torrent?passkey=secret',
      'https://example.org/gone.torrent',
      magnetOf(1),
    ].join('\n'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      results: [
        { index: 0, result: 'added', hash: hashOf(1), name: `Name ${hashOf(1).slice(0, 4)}` },
        { index: 1, result: 'exists', hash: hashOf(2) },
        { index: 2, result: 'added', hash: linked.hash, name: `Name ${linked.hash.slice(0, 4)}` },
        { index: 3, result: 'failed', error: 'The link answered HTTP 404' },
        // A second copy ends as the first did: it is there now.
        { index: 4, result: 'exists', hash: hashOf(1) },
      ],
    });
    // A link can carry a passkey: the answer never repeats one.
    expect(JSON.stringify(body)).not.toContain('passkey');
    expect(mocks.qbit.addMagnet).toHaveBeenCalledTimes(1);
    expect(mocks.qbit.addTorrentFile).toHaveBeenCalledTimes(1);
  });

  it('keeps at most 25 MB of fetched .torrent files for one add', async () => {
    // Three valid 9 MB files (a big pieces field): the third would pass 25 MB.
    const big = (name: string) => {
      const info = `d4:name${name.length}:${name}12:piece lengthi16384e6:pieces${9 * 1024 * 1024}:${'x'.repeat(9 * 1024 * 1024)}e`;
      return { bytes: new TextEncoder().encode(`d8:announce4:http4:info${info}e`), hash: createHash('sha1').update(info).digest('hex') };
    };
    const files = [big('One'), big('Two'), big('Three')];
    for (const file of files) mocks.fetchTorrentLink.mockResolvedValueOnce({ kind: 'file', bytes: file.bytes });

    const res = await addLinks(['https://example.org/1.torrent', 'https://example.org/2.torrent', 'https://example.org/3.torrent'].join('\n'));
    const { results } = await res.json();
    expect(results.map((item: { result: string }) => item.result)).toEqual(['added', 'added', 'failed']);
    expect(results[2].error).toBe('These links come to more than 25 MB of .torrent files; add fewer at once');
    expect(mocks.qbit.addTorrentFile).toHaveBeenCalledTimes(2);
  });

  it('adds a link that redirects to a magnet as that magnet', async () => {
    mocks.fetchTorrentLink.mockResolvedValueOnce({ kind: 'magnet', magnet: magnetOf(3) });
    const res = await addLinks('https://indexer.example.org/download?id=1');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, hash: hashOf(3) });
    expect(mocks.qbit.addMagnet).toHaveBeenCalledWith(magnetOf(3), expect.any(Object));
  });

  it('adds a fetched .torrent stopped when the files are to be chosen first', async () => {
    const linked = torrentOf('Review');
    mocks.fetchTorrentLink.mockResolvedValueOnce({ kind: 'file', bytes: linked.bytes });
    const res = await addLinks('https://example.org/r.torrent', { paused: false, stopCondition: 'MetadataReceived' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, hash: linked.hash });
    const options = mocks.qbit.addTorrentFile.mock.calls[0][2];
    expect(options).toMatchObject({ paused: true });
    expect(options).not.toHaveProperty('stopCondition');
  });

  it('answers a single link the way a single magnet always was', async () => {
    const linked = torrentOf('Single');
    have.add(linked.hash);
    mocks.fetchTorrentLink.mockResolvedValueOnce({ kind: 'file', bytes: linked.bytes });
    const exists = await addLinks('https://example.org/s.torrent');
    expect(exists.status).toBe(409);
    expect(await exists.json()).toEqual({ error: 'Torrent already exists' });

    mocks.fetchTorrentLink.mockResolvedValueOnce({ kind: 'file', bytes: new TextEncoder().encode('<html>Sign in</html>') });
    const notTorrent = await addLinks('https://example.org/login.torrent');
    expect(notTorrent.status).toBe(502);
    expect(await notTorrent.json()).toEqual({ error: 'The link did not give a .torrent file' });

    mocks.fetchTorrentLink.mockRejectedValueOnce(new TorrentLinkError(PRIVATE_LINK_MESSAGE));
    const lan = await addLinks('https://rebinds-to-lan.example.org/x.torrent');
    expect(lan.status).toBe(400);
    expect(await lan.json()).toEqual({ error: PRIVATE_LINK_MESSAGE });
  });

  it('reports a torrent qBittorrent never lists as not confirmed', async () => {
    vi.useFakeTimers();
    try {
      mocks.qbit.addMagnet.mockResolvedValue('Ok.');
      const pending = addLinks(`${magnetOf(4)}\n${magnetOf(5)}`);
      await vi.advanceTimersByTimeAsync(6000);
      const res = await pending;
      expect((await res.json()).results).toEqual([
        { index: 0, result: 'failed', error: 'qBittorrent did not confirm the torrent within 5 seconds' },
        { index: 1, result: 'failed', error: 'qBittorrent did not confirm the torrent within 5 seconds' },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives a second copy of a failed torrent the same failure', async () => {
    mocks.qbit.addMagnet.mockResolvedValue('Fails.');
    const res = await addLinks(`${magnetOf(6)}\n${magnetOf(6)}`);
    expect((await res.json()).results).toEqual([
      { index: 0, result: 'failed', error: 'qBittorrent rejected the magnet link' },
      { index: 1, result: 'failed', error: 'qBittorrent rejected the magnet link' },
    ]);
  });

  it('still reports what was added when a confirmation look fails', async () => {
    let calls = 0;
    mocks.qbit.getTorrents.mockImplementation((...args: unknown[]) => {
      calls += 1;
      // The duplicate check, then a first look that sees only the first, then qBittorrent stops answering.
      if (calls === 1) return list(...args);
      if (calls === 2) return Promise.resolve([{ hash: hashOf(7), name: 'Seven' }]);
      return Promise.reject(new Error('timeout of 30000ms exceeded'));
    });
    vi.useFakeTimers();
    try {
      const pending = addLinks(`${magnetOf(7)}\n${magnetOf(8)}`);
      await vi.advanceTimersByTimeAsync(1000);
      const res = await pending;
      expect(res.status).toBe(200);
      expect((await res.json()).results).toEqual([
        { index: 0, result: 'added', hash: hashOf(7), name: 'Seven' },
        { index: 1, result: 'failed', error: 'qBittorrent did not confirm the torrent within 5 seconds' },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['a scheme other than http(s) or magnet', 'ftp://example.org/a.torrent', 'Enter a magnet link or an http(s) link to a .torrent file'],
    ['a file: URL', 'file:///etc/passwd', 'Enter a magnet link or an http(s) link to a .torrent file'],
    ['a javascript: URL', 'javascript:alert(1)', 'Enter a magnet link or an http(s) link to a .torrent file'],
    ['a loopback address', 'http://127.0.0.1:8080/a.torrent', PRIVATE_LINK_MESSAGE],
    ['a LAN address', 'http://192.168.0.10/a.torrent', PRIVATE_LINK_MESSAGE],
    ['the cloud metadata address', 'http://169.254.169.254/latest/meta-data', BLOCKED_LINK_MESSAGE],
    ['an IPv6 loopback', 'http://[::1]/a.torrent', PRIVATE_LINK_MESSAGE],
    ['IPv4 wrapped in IPv6', 'http://[::ffff:127.0.0.1]/a.torrent', PRIVATE_LINK_MESSAGE],
    ['localhost', 'http://localhost:3050/a.torrent', PRIVATE_LINK_MESSAGE],
    ['a single-label name', 'http://prowlarr:9696/1/download', PRIVATE_LINK_MESSAGE],
    ['credentials in the link', 'https://user:pass@example.org/a.torrent', 'Leave the user name and password out of the link'],
  ])('refuses a member %s before fetching or adding anything', async (_label, line, error) => {
    mocks.requireUser.mockResolvedValue({ ok: true, user: MEMBER, session: {} });
    const res = await addLinks(line);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(mocks.fetchTorrentLink).not.toHaveBeenCalled();
    expect(mocks.qbit.addMagnet).not.toHaveBeenCalled();
  });

  it.each([
    ['the cloud metadata address', 'http://169.254.169.254/latest/meta-data'],
    ['an IPv6 link-local address', 'http://[fe80::1]/a.torrent'],
    ['a metadata name', 'http://metadata.google.internal/a.torrent'],
  ])('refuses an admin %s too', async (_label, line) => {
    const res = await addLinks(line);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: BLOCKED_LINK_MESSAGE });
    expect(mocks.fetchTorrentLink).not.toHaveBeenCalled();
  });

  it("fetches an admin's LAN link with the admin's rules", async () => {
    const linked = torrentOf('From Prowlarr');
    mocks.fetchTorrentLink.mockResolvedValueOnce({ kind: 'file', bytes: linked.bytes });
    const res = await addLinks('http://192.168.0.124:9696/1/download?apikey=x');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, hash: linked.hash });
    expect(mocks.fetchTorrentLink).toHaveBeenCalledWith('http://192.168.0.124:9696/1/download?apikey=x', { allowPrivate: true });
  });

  it("fetches a member's public link with the member's rules, so a redirect to the LAN is refused", async () => {
    mocks.requireUser.mockResolvedValue({ ok: true, user: MEMBER, session: {} });
    mocks.fetchTorrentLink.mockRejectedValueOnce(new TorrentLinkError(PRIVATE_LINK_MESSAGE));
    const res = await addLinks('https://example.org/redirects-to-lan.torrent');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: PRIVATE_LINK_MESSAGE });
    expect(mocks.fetchTorrentLink).toHaveBeenCalledWith('https://example.org/redirects-to-lan.torrent', { allowPrivate: false });
  });

  it('names the line it refuses when several are sent, and adds none of them', async () => {
    mocks.requireUser.mockResolvedValue({ ok: true, user: MEMBER, session: {} });
    const res = await addLinks(`${magnetOf(1)}\nhttp://10.0.0.5/a.torrent`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: `Line 2: ${PRIVATE_LINK_MESSAGE}` });
    expect(mocks.qbit.addMagnet).not.toHaveBeenCalled();
  });

  it('refuses more than 20 at once', async () => {
    const res = await addLinks(Array.from({ length: 21 }, (_, i) => magnetOf(i % 9)).join('\n'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Add at most 20 torrents at once' });
  });

  it('refuses a user without torrents.add', async () => {
    mocks.requireUser.mockResolvedValue({ ok: true, user: VIEWER, session: {} });
    const res = await addLinks(`${magnetOf(1)}\nhttps://example.org/a.torrent`);
    expect(res.status).toBe(403);
    expect(mocks.fetchTorrentLink).not.toHaveBeenCalled();
  });

  it('fetches no link while the shared options are refused', async () => {
    const res = await addLinks('https://example.org/a.torrent', { category: '../escape' });
    expect(res.status).toBe(400);
    expect(mocks.fetchTorrentLink).not.toHaveBeenCalled();
  });
});

describe('adding several .torrent files at once', () => {
  it('reports each file and skips the one that is not a torrent', async () => {
    const a = torrentOf('A');
    const b = torrentOf('B');
    have.add(b.hash);
    const res = await addFiles([
      { name: 'a.torrent', bytes: a.bytes },
      { name: 'b.torrent', bytes: b.bytes },
      { name: 'c.torrent', bytes: new TextEncoder().encode('not a torrent') },
    ], { paused: 'true' });
    expect(res.status).toBe(200);
    expect((await res.json()).results).toEqual([
      { index: 0, result: 'added', hash: a.hash, name: `Name ${a.hash.slice(0, 4)}` },
      { index: 1, result: 'exists', hash: b.hash },
      { index: 2, result: 'failed', error: 'Torrent file must start with a bencoded dictionary' },
    ]);
    expect(mocks.qbit.addTorrentFile).toHaveBeenCalledTimes(1);
    expect(mocks.qbit.addTorrentFile.mock.calls[0][2]).toMatchObject({ paused: true });
  });

  it('keeps the one-file answer for a file that is not a torrent', async () => {
    const res = await addFiles([{ name: 'c.torrent', bytes: new TextEncoder().encode('nope') }]);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Torrent file must start with a bencoded dictionary' });
  });

  it('refuses more than 20 files', async () => {
    const res = await addFiles(Array.from({ length: 21 }, (_, i) => ({ name: `${i}.torrent`, bytes: torrentOf(`T${i}`).bytes })));
    expect(res.status).toBe(400);
    expect(mocks.qbit.addTorrentFile).not.toHaveBeenCalled();
  });

  it('refuses a body past the 10 MB the proxy passes on', async () => {
    const res = await POST(new NextRequest('http://localhost/api/qbittorrent', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(11 * 1024 * 1024) },
      body: '--x--',
    }));
    expect(res.status).toBe(413);
  });
});
