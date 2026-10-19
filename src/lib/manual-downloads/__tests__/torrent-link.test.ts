import { describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => new Map<string, string>());
vi.mock('@/lib/redis', () => ({
  getRedisClient: async () => ({
    set: async (key: string, value: string) => { store.set(key, value); return 'OK'; },
    getDel: async (key: string) => { const value = store.get(key) ?? null; store.delete(key); return value; },
    del: async (key: string) => (store.delete(key) ? 1 : 0),
  }),
}));

import { offerTorrentToArr, takeTorrentForArr, withdrawTorrentLink } from '../torrent-link';
import { GET } from '@/app/api/manual-downloads/torrent/[token]/route';

const fetchLink = (url: string) => GET(new Request(url), { params: Promise.resolve({ token: url.slice(url.lastIndexOf('/') + 1) }) });

describe('the .torrent link Arr fetches', () => {
  it('serves the bytes once, then never again', async () => {
    const bytes = Buffer.from('d4:infod4:name1:xee');
    const url = await offerTorrentToArr(bytes, 'http://helprr.lan:3050');
    expect(url).toMatch(/^http:\/\/helprr\.lan:3050\/api\/manual-downloads\/torrent\/[A-Za-z0-9_-]{43}$/);

    const first = await fetchLink(url);
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toBe('application/x-bittorrent');
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(Buffer.from(await first.arrayBuffer())).toEqual(bytes);

    expect((await fetchLink(url)).status).toBe(404);
  });

  it('refuses malformed tokens without asking Redis, and can be withdrawn unused', async () => {
    expect(await takeTorrentForArr('../../etc/passwd')).toBeNull();
    expect((await GET(new Request('http://x/y'), { params: Promise.resolve({ token: 'short' }) })).status).toBe(404);

    const url = await offerTorrentToArr(Buffer.from('x'), 'http://helprr.lan');
    await withdrawTorrentLink(url);
    expect((await fetchLink(url)).status).toBe(404);
  });
});
