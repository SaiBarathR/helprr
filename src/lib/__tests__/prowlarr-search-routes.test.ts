import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    prowlarr: { searchReleases: vi.fn(), grabRelease: vi.fn() },
    requireUserCapability: vi.fn(),
    redis: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      multi: vi.fn(() => {
        const batch = {
          set: vi.fn((key: string, value: string) => { store.set(key, value); return batch; }),
          exec: vi.fn(async () => []),
        };
        return batch;
      }),
    },
  };
});

vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.requireUserCapability }));
const logging = vi.hoisted(() => ({ options: [] as unknown[] }));
vi.mock('@/lib/api-logger', () => ({
  withApiLogging: (handler: unknown, _name: string, options?: unknown) => { logging.options.push(options); return handler; },
}));
vi.mock('@/lib/service-helpers', () => ({ getProwlarrClient: vi.fn(async () => mocks.prowlarr) }));
vi.mock('@/lib/redis', () => ({ getRedisClient: vi.fn(async () => mocks.redis) }));

import { GET as searchGet } from '@/app/api/prowlarr/search/route';
import { POST as grabPost } from '@/app/api/prowlarr/search/grab/route';

const SECRET = 'S3cretPasskey0123456789abcdef';
const release = {
  guid: `https://tracker.example/download.php?id=5&passkey=${SECRET}`,
  indexerId: 7,
  indexer: 'Tracker',
  title: 'Big Buck Bunny 1080p',
  size: 1000,
  seeders: 10,
  leechers: 2,
  publishDate: '2026-10-01T00:00:00Z',
  protocol: 'torrent',
  downloadUrl: `http://prowlarr:9696/7/download?apikey=${SECRET}&link=x`,
  magnetUrl: `magnet:?xt=urn:btih:abc&tr=https://tracker.example/${SECRET}/announce`,
  infoUrl: `https://tracker.example/details?id=5&passkey=${SECRET}`,
  commentUrl: `https://tracker.example/${SECRET}`,
};

const search = (query: string) => searchGet(new NextRequest(`http://localhost/api/prowlarr/search?${query}`));
const grab = (body: unknown) => grabPost(new NextRequest('http://localhost/api/prowlarr/search/grab', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
}));
const as = (id: string) => mocks.requireUserCapability.mockResolvedValue({ ok: true, user: { id, role: 'admin' }, session: {} });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.store.clear();
  as('admin-1');
  mocks.prowlarr.searchReleases.mockResolvedValue([release]);
  mocks.prowlarr.grabRelease.mockResolvedValue(release);
});

describe('GET /api/prowlarr/search', () => {
  it('needs prowlarr.manage and stops before Prowlarr when refused', async () => {
    mocks.requireUserCapability.mockResolvedValue({ ok: false, response: NextResponse.json({}, { status: 403 }) });

    const res = await search('q=bunny');

    expect(mocks.requireUserCapability).toHaveBeenCalledWith('prowlarr.manage');
    expect(res.status).toBe(403);
    expect(mocks.prowlarr.searchReleases).not.toHaveBeenCalled();
  });

  it('returns display fields and a token, and nothing that can carry a key', async () => {
    const res = await search('q=bunny&categories=2000,5000');
    const text = await res.text();
    const { results } = JSON.parse(text);

    expect(res.status).toBe(200);
    expect(text).not.toContain(SECRET);
    expect(text).not.toMatch(/guid|downloadUrl|magnetUrl|infoUrl|commentUrl|apikey/i);
    expect(Object.keys(results[0]).sort()).toEqual(
      ['id', 'indexer', 'leechers', 'protocol', 'publishDate', 'seeders', 'size', 'title'],
    );
    expect(mocks.prowlarr.searchReleases).toHaveBeenCalledWith(
      { query: 'bunny', categories: [2000, 5000] }, expect.anything(),
    );
  });

  it('keeps the search text out of the request log', () => {
    expect(logging.options).toContainEqual({ redactQueryParams: ['q'] });
  });

  it('redacts the indexer name as well as the title', async () => {
    mocks.prowlarr.searchReleases.mockResolvedValue([{ ...release, indexer: `https://t.example/${SECRET}`, title: `https://t.example/${SECRET}` }]);

    const text = await (await search('q=bunny')).text();

    expect(text).not.toContain(SECRET);
  });

  it('keeps the 100 best-seeded results', async () => {
    mocks.prowlarr.searchReleases.mockResolvedValue(
      Array.from({ length: 150 }, (_, i) => ({ ...release, guid: `g${i}`, seeders: i })),
    );

    const { results } = await (await search('q=bunny')).json();

    expect(results).toHaveLength(100);
    expect(results[0].seeders).toBe(149);
  });

  it.each([['too short', 'q=a'], ['too long', `q=${'a'.repeat(201)}`], ['a bad category', 'q=bunny&categories=6000']])(
    'rejects %s', async (_label, query) => {
      expect((await search(query)).status).toBe(400);
      expect(mocks.prowlarr.searchReleases).not.toHaveBeenCalled();
    },
  );

  it('sends nothing to the browser when the tokens cannot be stored', async () => {
    mocks.redis.multi.mockImplementationOnce(() => { throw new Error('redis down'); });

    const res = await search('q=bunny');

    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('Big Buck Bunny');
  });
});

describe('POST /api/prowlarr/search/grab', () => {
  async function token() {
    return (await (await search('q=bunny')).json()).results[0].id as string;
  }

  it('grabs by token with the stored guid and returns no upstream data', async () => {
    const res = await grab({ id: await token() });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.prowlarr.grabRelease).toHaveBeenCalledWith({ guid: release.guid, indexerId: 7 });
  });

  it('refuses a token issued to another user', async () => {
    const id = await token();
    as('member-2');

    expect((await grab({ id })).status).toBe(410);
    expect(mocks.prowlarr.grabRelease).not.toHaveBeenCalled();
  });

  it.each([['an unknown token', { id: 'nope' }, 410], ['no token', {}, 400], ['a raw guid object', { id: { guid: 'x' } }, 400]])(
    'refuses %s', async (_label, body, status) => {
      expect((await grab(body)).status).toBe(status);
      expect(mocks.prowlarr.grabRelease).not.toHaveBeenCalled();
    },
  );

  it('explains a missing download client', async () => {
    mocks.prowlarr.grabRelease.mockRejectedValue(new Error("Torrent Download client isn't configured yet"));

    const res = await grab({ id: await token() });

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('Set up a download client in Prowlarr to grab from here');
  });

  it('treats a release Prowlarr no longer holds as expired', async () => {
    mocks.prowlarr.grabRelease.mockRejectedValue(new Error("Couldn't find requested release in cache, try searching again"));

    expect((await grab({ id: await token() })).status).toBe(410);
  });

  it('hides any other upstream detail', async () => {
    mocks.prowlarr.grabRelease.mockRejectedValue(new Error(`failed at https://tracker.example/${SECRET}`));

    const res = await grab({ id: await token() });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Grab failed' });
  });
});
