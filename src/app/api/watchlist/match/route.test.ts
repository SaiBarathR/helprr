import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  getLibraryLookups: vi.fn(),
  resolveConnection: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUserCapability: vi.fn(async () => ({ ok: true, user: { id: 'u1' } })) }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));
vi.mock('@/lib/db', () => ({ prisma: { watchlistItem: { findMany: mocks.findMany } } }));
vi.mock('@/lib/arr-instances', () => ({ resolveConnection: mocks.resolveConnection }));
vi.mock('@/lib/watchlist-library-lookup', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getLibraryLookups: mocks.getLibraryLookups,
}));

import { GET } from './route';

const get = async (query: string) => (await GET(new NextRequest(`http://helprr.test/api/watchlist/match?${query}`))).json();

// Radarr id 5 is "Film" on rad-a (the default) and "Other" on rad-b.
const lookups = {
  radarrByTmdbId: new Map(), sonarrByTvdbId: new Map(), sonarrByTmdbId: new Map(), sonarrById: new Map(),
  radarrById: new Map([[5, [{ instanceId: 'rad-a', title: 'Film' }, { instanceId: 'rad-b', title: 'Other' }]]]),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getLibraryLookups.mockResolvedValue(lookups);
  mocks.resolveConnection.mockImplementation(async (_type: string, id: string | null) => ({ id: id ?? 'rad-a' }));
});

describe('GET /api/watchlist/match', () => {
  it('finds a title saved from Discover by its TMDB id, for this person only', async () => {
    mocks.findMany.mockResolvedValue([{ id: 'w1', title: 'Film', source: 'TMDB', externalId: '603' }]);

    expect(await get('mediaType=movie&tmdbId=603&arr=rad-a:5')).toEqual({ item: { id: 'w1', title: 'Film' } });
    const { where } = mocks.findMany.mock.calls[0][0];
    expect(where).toMatchObject({ userId: 'u1', mediaType: 'movie' });
    expect(where.OR).toEqual([
      { source: 'TMDB', externalId: '603' },
      { source: 'RADARR', externalId: { in: ['5'] } },
    ]);
    expect(mocks.getLibraryLookups).not.toHaveBeenCalled();
  });

  it('finds a title saved from its library page only on the instance it was saved from', async () => {
    mocks.findMany.mockResolvedValue([{ id: 'w2', title: 'Film', source: 'RADARR', externalId: '5' }]);
    expect(await get('mediaType=movie&tmdbId=603&arr=rad-a:5')).toEqual({ item: { id: 'w2', title: 'Film' } });
    // No instance in the page's URL: the default instance.
    expect(await get('mediaType=movie&tmdbId=603&arr=:5')).toEqual({ item: { id: 'w2', title: 'Film' } });
    // Radarr id 5 on rad-b is another film.
    expect(await get('mediaType=movie&tmdbId=999&arr=rad-b:5')).toEqual({ item: null });
  });

  it('counts as saved on every instance where that id is the same title', async () => {
    mocks.getLibraryLookups.mockResolvedValue({ ...lookups, radarrById: new Map([[5, [{ instanceId: 'rad-a', title: 'Film' }, { instanceId: 'rad-4k', title: 'Film' }]]]) });
    mocks.findMany.mockResolvedValue([{ id: 'w2', title: 'Film', source: 'RADARR', externalId: '5' }]);
    expect(await get('mediaType=movie&arr=rad-4k:5')).toEqual({ item: { id: 'w2', title: 'Film' } });
  });

  it('shows nothing saved when the item\'s instance is unclear (edited title, id on two instances)', async () => {
    mocks.findMany.mockResolvedValue([{ id: 'w3', title: 'My edited name', source: 'RADARR', externalId: '5' }]);
    expect(await get('mediaType=movie&arr=rad-a:5')).toEqual({ item: null });
    expect(await get('mediaType=movie&arr=rad-b:5')).toEqual({ item: null });
  });

  it('asks by TVDB id for a series, and needs some id', async () => {
    mocks.findMany.mockResolvedValue([]);
    await get('mediaType=series&tvdbId=81189');
    expect(mocks.findMany.mock.calls[0][0].where.OR).toEqual([{ source: 'TVDB', externalId: '81189' }]);

    vi.clearAllMocks();
    expect(await get('mediaType=movie&tmdbId=abc&arr=x:0')).toEqual({ item: null });
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect((await GET(new NextRequest('http://helprr.test/api/watchlist/match?mediaType=anime&tmdbId=1'))).status).toBe(400);
  });

  it('shows a library-saved title as not saved when its instance cannot be read', async () => {
    mocks.findMany.mockResolvedValue([{ id: 'w2', title: 'Film', source: 'RADARR', externalId: '5' }]);
    mocks.resolveConnection.mockRejectedValue(new Error('No RADARR instance'));
    expect(await get('mediaType=movie&arr=gone:5')).toEqual({ item: null });
  });
});
