import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    prowlarr: {
      searchReleases: vi.fn(), grabRelease: vi.fn(), getIndexers: vi.fn(), getCategories: vi.fn(), getDownloadClients: vi.fn(),
    },
    // The acting user; each gate below checks its capabilities with the real can().
    user: { id: 'admin-1', role: 'admin', template: 'admin', permissions: {} as Record<string, boolean> },
    cache: new Map<string, unknown>(),
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

vi.mock('@/lib/auth', async () => {
  const { can } = await import('@/lib/permissions');
  const { NextResponse: Res } = await import('next/server');
  const gate = (allowed: boolean) => (allowed
    ? { ok: true, user: mocks.user, session: {} }
    : { ok: false, response: Res.json({ error: 'Forbidden' }, { status: 403 }) });
  return {
    requireUserCapability: vi.fn(async (cap: never) => gate(can(mocks.user as never, cap))),
    requireUserAnyCapability: vi.fn(async (caps: never[]) => gate(caps.some((cap) => can(mocks.user as never, cap)))),
  };
});
vi.mock('@/lib/cache/json-cache', () => ({
  getCachedJson: vi.fn(async (scope: string, seed: string) => mocks.cache.get(`${scope}:${seed}`) ?? null),
  setCachedJson: vi.fn(async (scope: string, seed: string, value: unknown) => { mocks.cache.set(`${scope}:${seed}`, value); }),
}));
const logging = vi.hoisted(() => ({ options: [] as unknown[] }));
vi.mock('@/lib/api-logger', () => ({
  withApiLogging: (handler: unknown, _name: string, options?: unknown) => { logging.options.push(options); return handler; },
}));
vi.mock('@/lib/service-helpers', () => ({ getProwlarrClient: vi.fn(async () => mocks.prowlarr) }));
vi.mock('@/lib/redis', () => ({ getRedisClient: vi.fn(async () => mocks.redis) }));

import { GET as searchGet } from '@/app/api/prowlarr/search/route';
import { POST as grabPost } from '@/app/api/prowlarr/search/grab/route';
import { GET as categoriesGet } from '@/app/api/prowlarr/categories/route';
import { GET as clientsGet } from '@/app/api/prowlarr/downloadclients/route';

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
const as = (id: string) => { mocks.user = { id, role: 'admin', template: 'admin', permissions: {} }; };
// A member with only these Prowlarr capabilities on top of the member template.
const member = (permissions: Record<string, boolean>) => { mocks.user = { id: 'member-1', role: 'member', template: 'member', permissions }; };

const tree = [
  { id: 2000, name: 'Movies', subCategories: [{ id: 2040, name: 'Movies/HD', subCategories: [] }] },
  { id: 5000, name: 'TV', subCategories: [{ id: 5070, name: 'TV/Anime', subCategories: [] }] },
  { id: 0, name: 'Other', subCategories: [{ id: 10, name: 'Other/Misc', subCategories: [] }] },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.store.clear();
  mocks.cache.clear();
  as('admin-1');
  mocks.prowlarr.getCategories.mockResolvedValue(tree);
  mocks.prowlarr.getDownloadClients.mockResolvedValue([
    { id: 4, name: 'Spare', protocol: 'torrent', enable: true, priority: 2, fields: [{ name: 'password', value: SECRET }] },
    { id: 1, name: 'qBittorrent', protocol: 'torrent', enable: true, priority: 1, fields: [{ name: 'password', value: SECRET }] },
    { id: 2, name: 'SABnzbd', protocol: 'usenet', enable: true, priority: 1, fields: [] },
    { id: 3, name: 'Old', protocol: 'torrent', enable: false, priority: 1, fields: [] },
  ]);
  mocks.prowlarr.searchReleases.mockResolvedValue([release]);
  mocks.prowlarr.grabRelease.mockResolvedValue(release);
  mocks.prowlarr.getIndexers.mockResolvedValue([
    { id: 1, name: 'Public', enable: true, privacy: 'public' },
    { id: 2, name: 'Usenet', enable: true, privacy: 'private' },
    { id: 3, name: 'Off', enable: false, privacy: 'private' },
    { id: 7, name: 'Tracker', enable: true, privacy: 'private' },
  ]);
});

describe('GET /api/prowlarr/search', () => {
  it('refuses a member with view only, before Prowlarr', async () => {
    member({ 'prowlarr.view': true });

    const res = await search('q=bunny');

    expect(res.status).toBe(403);
    expect(mocks.prowlarr.searchReleases).not.toHaveBeenCalled();
  });

  it.each([['prowlarr.search', { 'prowlarr.view': true, 'prowlarr.search': true }], ['prowlarr.manage alone', { 'prowlarr.manage': true }]])(
    'lets a member with %s search', async (_label, permissions) => {
      member(permissions);

      expect((await search('q=bunny')).status).toBe(200);
      expect(mocks.prowlarr.searchReleases).toHaveBeenCalled();
    },
  );

  it('returns display fields and a token, and nothing that can carry a key', async () => {
    const res = await search('q=bunny&categories=2000,5000');
    const text = await res.text();
    const { results } = JSON.parse(text);

    expect(res.status).toBe(200);
    expect(text).not.toContain(SECRET);
    expect(text).not.toMatch(/guid|downloadUrl|magnetUrl|infoUrl|commentUrl|apikey/i);
    expect(Object.keys(results[0]).sort()).toEqual(
      ['categories', 'flags', 'grabs', 'id', 'indexer', 'leechers', 'protocol', 'publishDate', 'seeders', 'size', 'title'],
    );
    expect(mocks.prowlarr.searchReleases).toHaveBeenCalledWith(
      { query: 'bunny', type: 'search', categories: [2000, 5000], indexerIds: [] }, expect.anything(),
    );
  });

  it('adds category names, grabs and known flags, and keeps ratio flags off public trackers', async () => {
    const categories = [
      { id: 2000, name: 'Movies', subCategories: [] },
      { id: 2040, name: 'Movies/HD', subCategories: [] },
      { id: 101234, subCategories: [] },
    ];
    mocks.prowlarr.searchReleases.mockResolvedValue([
      { ...release, guid: 'private', grabs: 12, indexerFlags: ['freeleech', 'Internal', 'passkey=abc', 'nuked'], categories },
      { ...release, guid: 'public', indexerId: 1, grabs: null, indexerFlags: ['freeleech', 'scene'], categories: [{ id: 5000, name: 'TV', subCategories: [] }] },
    ]);

    const { results } = await (await search('q=bunny')).json();

    expect(results[0]).toMatchObject({ grabs: 12, flags: ['freeleech', 'internal', 'nuked'], categories: ['Movies/HD'] });
    expect(results[1]).toMatchObject({ grabs: null, flags: ['scene'], categories: ['TV'] });
  });

  it('still searches when the indexer list cannot be read, keeping the flags', async () => {
    mocks.prowlarr.getIndexers.mockRejectedValue(new Error('down'));
    mocks.prowlarr.searchReleases.mockResolvedValue([{ ...release, indexerFlags: ['freeleech'] }]);

    const res = await search('q=bunny');

    expect(res.status).toBe(200);
    expect((await res.json()).results[0].flags).toEqual(['freeleech']);
  });

  it('does not wait on a slow indexer list that only trims flags', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      mocks.prowlarr.getIndexers.mockReturnValue(new Promise(() => {}));
      mocks.prowlarr.searchReleases.mockResolvedValue([{ ...release, indexerFlags: ['freeleech'] }]);

      const pending = search('q=bunny');
      await vi.advanceTimersByTimeAsync(5_000);
      const res = await pending;

      expect(res.status).toBe(200);
      expect((await res.json()).results[0].flags).toEqual(['freeleech']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes any category in Prowlarr\'s tree, subcategories included, and reads the tree once', async () => {
    await search('q=bunny&categories=5070,2040');
    await search('q=bunny&categories=2000');

    expect(mocks.prowlarr.searchReleases).toHaveBeenCalledWith(
      expect.objectContaining({ categories: [5070, 2040] }), expect.anything(),
    );
    expect(mocks.prowlarr.getCategories).toHaveBeenCalledTimes(1);
  });

  it.each([['one not in the tree', '9999'], ['the placeholder Other branch', '10'], ['not a number', '2000,abc']])(
    'refuses a category that is %s without searching', async (_label, categories) => {
      expect((await search(`q=bunny&categories=${categories}`)).status).toBe(400);
      expect(mocks.prowlarr.searchReleases).not.toHaveBeenCalled();
    },
  );

  it('keeps the search text out of the request log', () => {
    expect(logging.options).toContainEqual({ redactQueryParams: ['q'] });
  });

  it('redacts the indexer name as well as the title', async () => {
    mocks.prowlarr.searchReleases.mockResolvedValue([{ ...release, indexer: `https://t.example/${SECRET}`, title: `https://t.example/${SECRET}` }]);

    const text = await (await search('q=bunny')).text();

    expect(text).not.toContain(SECRET);
  });

  it('keeps 100 results when one set of rows tops every sort', async () => {
    mocks.prowlarr.searchReleases.mockResolvedValue(
      Array.from({ length: 150 }, (_, i) => ({ ...release, guid: `g${i}`, seeders: i, size: i, publishDate: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() })),
    );

    const { results, total } = await (await search('q=bunny')).json();

    expect(results).toHaveLength(100);
    expect(results.map((r: { seeders: number }) => r.seeders)).toContain(149);
    expect(results.map((r: { seeders: number }) => r.seeders)).not.toContain(49);
    expect(total).toBe(150);
  });

  it('keeps the largest and newest too, Usenet ones included, so any sort sees its own top rows', async () => {
    // 150 torrents, the most seeded smallest and oldest, plus large new Usenet posts with no seeders.
    const torrents = Array.from({ length: 150 }, (_, i) => ({
      ...release, guid: `t${i}`, seeders: 1000 + i, size: 1 + i, publishDate: `2020-01-01T00:${String(i % 60).padStart(2, '0')}:00Z`,
    }));
    const usenet = Array.from({ length: 5 }, (_, i) => ({
      ...release, guid: `u${i}`, protocol: 'usenet', seeders: undefined, size: 10_000 + i, publishDate: `2026-11-0${i + 1}T00:00:00Z`,
    }));
    mocks.prowlarr.searchReleases.mockResolvedValue([...torrents, ...usenet]);

    const { results, total } = await (await search('q=bunny')).json();
    const sortBy = (key: 'size' | 'publishDate') => [...results].sort((a, b) => (b[key] > a[key] ? 1 : -1));

    expect(total).toBe(155);
    expect(results.filter((r: { protocol: string }) => r.protocol === 'usenet')).toHaveLength(5);
    expect(sortBy('size')[0].size).toBe(10_004);
    expect(sortBy('publishDate')[0].publishDate).toBe('2026-11-05T00:00:00Z');
    expect(results.length).toBeLessThanOrEqual(300);
  });

  it('sends a TV search with its ids as Prowlarr query tokens', async () => {
    await search('q=&type=tvsearch&tvdbId=121361&season=1&episode=2');

    expect(mocks.prowlarr.searchReleases).toHaveBeenCalledWith(
      { query: '{TvdbId:121361}{Season:1}{Episode:2}', type: 'tvsearch', categories: [], indexerIds: [] },
      expect.anything(),
    );
  });

  it('sends a movie search with text and an IMDb id', async () => {
    await search('q=shawshank&type=movie&imdbId=tt0111161');

    expect(mocks.prowlarr.searchReleases).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'shawshank{ImdbId:tt0111161}', type: 'movie' }), expect.anything(),
    );
  });

  it('searches only the indexers picked, once they are known and enabled', async () => {
    await search('q=bunny&indexerIds=2,1,2');

    expect(mocks.prowlarr.searchReleases).toHaveBeenCalledWith(
      expect.objectContaining({ indexerIds: [2, 1] }), expect.anything(),
    );
  });

  it.each([['an unknown', '9'], ['a disabled', '3'], ['one unknown among known', '1,9']])(
    'refuses %s indexer without searching', async (_label, ids) => {
      const res = await search(`q=bunny&indexerIds=${ids}`);

      expect(res.status).toBe(400);
      expect(mocks.prowlarr.getIndexers).toHaveBeenCalled();
      expect(mocks.prowlarr.searchReleases).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['too short', 'q=a'],
    ['too long', `q=${'a'.repeat(201)}`],
    ['too many categories', `q=bunny&categories=${Array.from({ length: 101 }, (_, i) => i + 1).join(',')}`],
    ['an unknown type', 'q=bunny&type=tv-search'],
    ['an id with no text and no type', 'q=&tvdbId=121361'],
    ['an IMDb id without tt', 'q=&type=movie&imdbId=0111161'],
    ['an IMDb id with more after it', 'q=&type=movie&imdbId=tt0111161}{TmdbId:1'],
    ['a TVDB id that is not a number', 'q=&type=tvsearch&tvdbId=12a'],
    ['an id past what Prowlarr reads', 'q=&type=tvsearch&tvdbId=2147483648'],
    ['a TVDB id on a movie search', 'q=&type=movie&tvdbId=121361'],
    ['a season with nothing to search', 'q=&type=tvsearch&season=1'],
    ['an episode without a season', 'q=&type=tvsearch&tvdbId=121361&episode=2'],
    ['braces in a typed search', 'q=x{TvdbId:1}&type=tvsearch'],
    ['an indexer id that is not a number', 'q=bunny&indexerIds=1,abc'],
    ['too many indexers', `q=bunny&indexerIds=${Array.from({ length: 101 }, (_, i) => i + 1).join(',')}`],
  ])(
    'rejects %s without asking Prowlarr', async (_label, query) => {
      expect((await search(query)).status).toBe(400);
      expect(mocks.prowlarr.searchReleases).not.toHaveBeenCalled();
      expect(mocks.prowlarr.getIndexers).not.toHaveBeenCalled();
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
    expect(mocks.prowlarr.grabRelease).toHaveBeenCalledWith({ guid: release.guid, indexerId: 7, downloadClientId: undefined });
    expect(mocks.prowlarr.getDownloadClients).not.toHaveBeenCalled();
  });

  it('refuses a member who can search but not manage', async () => {
    member({ 'prowlarr.view': true, 'prowlarr.search': true });
    const id = await token();

    expect((await grab({ id })).status).toBe(403);
    expect(mocks.prowlarr.grabRelease).not.toHaveBeenCalled();
  });

  it('lets a member with manage grab', async () => {
    member({ 'prowlarr.manage': true });

    expect((await grab({ id: await token() })).status).toBe(200);
  });

  it('leaves the client to Prowlarr when the pick is null', async () => {
    const res = await grab({ id: await token(), downloadClientId: null });

    expect(res.status).toBe(200);
    expect(mocks.prowlarr.grabRelease).toHaveBeenCalledWith({ guid: release.guid, indexerId: 7, downloadClientId: undefined });
    expect(mocks.prowlarr.getDownloadClients).not.toHaveBeenCalled();
  });

  it('sends to the download client picked', async () => {
    const res = await grab({ id: await token(), downloadClientId: 4 });

    expect(res.status).toBe(200);
    expect(mocks.prowlarr.grabRelease).toHaveBeenCalledWith({ guid: release.guid, indexerId: 7, downloadClientId: 4 });
  });

  it.each([['a disabled client', 3], ['a client for the other protocol', 2], ['a client that is gone', 9]])(
    'refuses %s without grabbing', async (_label, downloadClientId) => {
      const res = await grab({ id: await token(), downloadClientId });

      expect(res.status).toBe(400);
      expect(mocks.prowlarr.grabRelease).not.toHaveBeenCalled();
    },
  );

  it.each([['a string', '4'], ['a fraction', 1.5], ['zero', 0], ['past an int', 2_147_483_648]])(
    'refuses a client id that is %s', async (_label, downloadClientId) => {
      expect((await grab({ id: 'x', downloadClientId })).status).toBe(400);
      expect(mocks.prowlarr.getDownloadClients).not.toHaveBeenCalled();
    },
  );

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

describe('GET /api/prowlarr/categories', () => {
  it('returns the tree as ids and names, without the placeholder branch', async () => {
    member({ 'prowlarr.search': true });

    const res = await categoriesGet();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: 2000, name: 'Movies', subCategories: [{ id: 2040, name: 'Movies/HD' }] },
      { id: 5000, name: 'TV', subCategories: [{ id: 5070, name: 'TV/Anime' }] },
    ]);
  });

  it('refuses a member with view only', async () => {
    member({ 'prowlarr.view': true });

    expect((await categoriesGet()).status).toBe(403);
    expect(mocks.prowlarr.getCategories).not.toHaveBeenCalled();
  });
});

describe('GET /api/prowlarr/downloadclients', () => {
  it('lists enabled clients by priority, with no fields', async () => {
    const res = await clientsGet();
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).not.toContain(SECRET);
    expect(JSON.parse(text)).toEqual([
      { id: 1, name: 'qBittorrent', protocol: 'torrent' },
      { id: 2, name: 'SABnzbd', protocol: 'usenet' },
      { id: 4, name: 'Spare', protocol: 'torrent' },
    ]);
  });

  it('returns an empty list when Prowlarr answers with something else', async () => {
    mocks.prowlarr.getDownloadClients.mockResolvedValue({ message: 'odd' });

    expect(await (await clientsGet()).json()).toEqual([]);
  });

  it('needs manage, not search', async () => {
    member({ 'prowlarr.view': true, 'prowlarr.search': true });

    expect((await clientsGet()).status).toBe(403);
    expect(mocks.prowlarr.getDownloadClients).not.toHaveBeenCalled();
  });
});
