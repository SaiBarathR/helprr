import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dns = vi.hoisted(() => ({ answers: {} as Record<string, { address: string; family: number }[]> }));

vi.mock('node:dns', () => ({
  lookup: (hostname: string, _options: unknown, cb: (e: Error | null, a: unknown) => void) => {
    const answer = dns.answers[hostname];
    if (!answer) cb(Object.assign(new Error('not found'), { code: 'ENOTFOUND' }), []);
    else cb(null, answer);
  },
}));

import { BLOCKED_LINK_MESSAGE, checkTorrentLink, fetchTorrentLink, PRIVATE_LINK_MESSAGE } from '@/lib/torrent-link-fetch';

// The add route's rules, as the notification channels': by the user's role.
const MEMBER = { allowPrivate: false };
const ADMIN = { allowPrivate: true };

const TORRENT = new TextEncoder().encode('d4:infod4:name1:aee');

function answer(status: number, extra: { location?: string; data?: Uint8Array } = {}) {
  return {
    status,
    headers: extra.location ? { location: extra.location } : {},
    data: extra.data ?? new Uint8Array(),
  };
}

beforeEach(() => {
  dns.answers = {};
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('checkTorrentLink', () => {
  it.each([
    ['http://127.0.0.1/a.torrent', PRIVATE_LINK_MESSAGE],
    ['http://10.1.2.3/a.torrent', PRIVATE_LINK_MESSAGE],
    ['http://[fd00::1]/a.torrent', PRIVATE_LINK_MESSAGE],
    ['http://2130706433/a.torrent', PRIVATE_LINK_MESSAGE], // 127.0.0.1 as one number
    ['http://nas.local/a.torrent', PRIVATE_LINK_MESSAGE],
    ['ftp://example.org/a.torrent', 'Enter a magnet link or an http(s) link to a .torrent file'],
    ['file:///etc/passwd', 'Enter a magnet link or an http(s) link to a .torrent file'],
    ['https://u:p@example.org/a.torrent', 'Leave the user name and password out of the link'],
    [`https://example.org/${'a'.repeat(2100)}`, 'The link is too long'],
  ])('refuses %s', (link, error) => {
    expect(checkTorrentLink(link, MEMBER)).toEqual({ ok: false, error });
  });

  it.each([
    'http://192.168.0.124:9696/1/download?apikey=x',
    'http://10.1.2.3/a.torrent',
    'http://127.0.0.1:9117/dl/a.torrent',
    'http://nas.local/a.torrent',
    'http://prowlarr:9696/1/download',
  ])('takes a LAN link from an admin: %s', (link) => {
    expect(checkTorrentLink(link, ADMIN)).toMatchObject({ ok: true });
  });

  it.each([
    'http://169.254.169.254/latest/meta-data',
    'http://[fe80::1]/a.torrent',
    'http://metadata.google.internal/a.torrent',
    'http://0.0.0.0/a.torrent',
  ])('refuses %s to everyone, admins too', (link) => {
    expect(checkTorrentLink(link, ADMIN)).toEqual({ ok: false, error: BLOCKED_LINK_MESSAGE });
    expect(checkTorrentLink(link, MEMBER)).toEqual({ ok: false, error: BLOCKED_LINK_MESSAGE });
  });

  it('tells a member that links must be on the internet', () => {
    expect(PRIVATE_LINK_MESSAGE).toMatch(/internet only/);
  });

  it('takes a public https link', () => {
    expect(checkTorrentLink(' https://example.org/a.torrent?passkey=1 ', MEMBER)).toMatchObject({ ok: true });
  });
});

describe('fetchTorrentLink', () => {
  it('asks with no redirects followed for it, no proxy, the guarded lookup and a size cap', async () => {
    const get = vi.spyOn(axios, 'get').mockResolvedValue(answer(200, { data: TORRENT }));
    await expect(fetchTorrentLink('https://example.org/a.torrent', MEMBER)).resolves.toEqual({ kind: 'file', bytes: TORRENT });
    const options = get.mock.calls[0][1]!;
    expect(options).toMatchObject({ maxRedirects: 0, proxy: false, maxContentLength: 10 * 1024 * 1024, responseType: 'arraybuffer' });
    expect(typeof options.lookup).toBe('function');
    expect(options.headers).not.toHaveProperty('Cookie');
  });

  it('follows a redirect to another public host, checking it again', async () => {
    const get = vi.spyOn(axios, 'get')
      .mockResolvedValueOnce(answer(302, { location: 'https://cdn.example.net/x.torrent' }))
      .mockResolvedValueOnce(answer(200, { data: TORRENT }));
    await expect(fetchTorrentLink('https://example.org/dl?id=1', MEMBER)).resolves.toMatchObject({ kind: 'file' });
    expect(get.mock.calls[1][0]).toBe('https://cdn.example.net/x.torrent');
  });

  it('returns the magnet a link redirects to', async () => {
    vi.spyOn(axios, 'get').mockResolvedValueOnce(answer(301, { location: 'magnet:?xt=urn:btih:abc' }));
    await expect(fetchTorrentLink('https://example.org/dl?id=1', MEMBER)).resolves.toEqual({ kind: 'magnet', magnet: 'magnet:?xt=urn:btih:abc' });
  });

  it.each([
    ['a LAN address', 'http://192.168.0.124:9696/api', PRIVATE_LINK_MESSAGE],
    ['loopback', 'http://localhost/x', PRIVATE_LINK_MESSAGE],
    ['a file: URL', 'file:///etc/passwd', 'The link redirected to something other than a web address'],
    ['a data: URL', 'data:application/x-bittorrent;base64,AAAA', 'The link redirected to something other than a web address'],
  ])('refuses a redirect to %s without asking it', async (_label, location, error) => {
    const get = vi.spyOn(axios, 'get').mockResolvedValueOnce(answer(302, { location }));
    await expect(fetchTorrentLink('https://example.org/dl', MEMBER)).rejects.toThrow(error);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('follows a redirect from a public host to the LAN for an admin', async () => {
    const get = vi.spyOn(axios, 'get')
      .mockResolvedValueOnce(answer(302, { location: 'http://192.168.0.124:9696/1/download' }))
      .mockResolvedValueOnce(answer(200, { data: TORRENT }));
    await expect(fetchTorrentLink('https://example.org/dl', ADMIN)).resolves.toEqual({ kind: 'file', bytes: TORRENT });
    expect(get.mock.calls[1][0]).toBe('http://192.168.0.124:9696/1/download');
  });

  it('refuses a redirect from the LAN to the metadata address for an admin', async () => {
    const get = vi.spyOn(axios, 'get').mockResolvedValueOnce(answer(302, { location: 'http://169.254.169.254/latest' }));
    await expect(fetchTorrentLink('http://192.168.0.124:9696/1/download', ADMIN)).rejects.toThrow(BLOCKED_LINK_MESSAGE);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('stops after three redirects', async () => {
    const get = vi.spyOn(axios, 'get').mockResolvedValue(answer(302, { location: 'https://example.org/again' }));
    await expect(fetchTorrentLink('https://example.org/dl', MEMBER)).rejects.toThrow('The link redirected too many times');
    expect(get).toHaveBeenCalledTimes(4);
  });

  it.each([
    [403, 'The link refused the download (HTTP 403); it may need you to be signed in to the site'],
    [404, 'The link answered HTTP 404'],
    [500, 'The link answered HTTP 500'],
  ])('says what HTTP %i means', async (status, error) => {
    vi.spyOn(axios, 'get').mockResolvedValueOnce(answer(status));
    await expect(fetchTorrentLink('https://example.org/a.torrent', MEMBER)).rejects.toThrow(error);
  });

  it('says a file past the cap is too large', async () => {
    vi.spyOn(axios, 'get').mockRejectedValueOnce(Object.assign(new Error('maxContentLength size of 10485760 exceeded'), { code: 'ERR_BAD_RESPONSE' }));
    await expect(fetchTorrentLink('https://example.org/a.torrent', MEMBER)).rejects.toThrow('The link gave a file over 10 MB');
  });

  it('never puts the link (or its passkey) in the error', async () => {
    vi.spyOn(axios, 'get').mockRejectedValueOnce(Object.assign(new Error('getaddrinfo ENOTFOUND tracker.example.org/?passkey=SECRET'), { code: 'ENOTFOUND' }));
    const error = await fetchTorrentLink('https://tracker.example.org/a.torrent?passkey=SECRET', MEMBER).catch((e: Error) => e);
    expect(String((error as Error).message)).not.toContain('SECRET');
  });

  // The real request path: the name resolves to a LAN address, so no connection is made.
  it('refuses a public-looking name that resolves to a private address', async () => {
    dns.answers['rebind.example.org'] = [{ address: '192.168.0.10', family: 4 }];
    await expect(fetchTorrentLink('http://rebind.example.org/a.torrent', MEMBER)).rejects.toThrow(PRIVATE_LINK_MESSAGE);
  });

  it("refuses an admin's name that resolves to the metadata address", async () => {
    dns.answers['rebind.example.org'] = [{ address: '169.254.169.254', family: 4 }];
    await expect(fetchTorrentLink('http://rebind.example.org/a.torrent', ADMIN)).rejects.toThrow(BLOCKED_LINK_MESSAGE);
  });
});
