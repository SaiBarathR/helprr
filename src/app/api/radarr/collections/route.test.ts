import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  client: {
    getCollections: vi.fn(),
    lookupMovie: vi.fn(),
    addMovie: vi.fn(),
    getQualityProfiles: vi.fn(),
    getRootFolders: vi.fn(),
    getTags: vi.fn(),
    updateCollections: vi.fn(),
    getCollection: vi.fn(),
    updateCollection: vi.fn(),
  },
  user: null as null | Record<string, unknown>,
}));

const ADMIN = { id: 'u1', role: 'admin', template: 'admin', permissions: {} };
const member = (permissions: Record<string, boolean>) => ({ id: 'm', role: 'member', template: 'member', permissions });

// Real permission resolution, so a member's capabilities decide each field.
vi.mock('@/lib/auth', async () => {
  const { can } = await import('@/lib/permissions');
  return {
    requireUserCapability: vi.fn(async (cap: never) => (can(mocks.user as never, cap)
      ? { ok: true, user: mocks.user }
      : { ok: false, response: Response.json({ error: 'Forbidden' }, { status: 403 }) })),
  };
});
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/service-helpers', () => ({ getRadarrClient: vi.fn(async () => mocks.client), getRadarrClients: vi.fn() }));
vi.mock('@/lib/arr-instances', () => ({ resolveConnection: vi.fn() }));
vi.mock('@/lib/cache/json-cache', () => ({ getCachedJson: vi.fn(async () => null) }));
vi.mock('@/lib/cache/tagged-library', () => ({ getCachedTaggedLibrary: vi.fn(), invalidateTaggedLibrary: vi.fn() }));

import { POST, PUT } from './route';

const collection = (extra: Record<string, unknown>) => ({
  id: 7, title: 'Pair', monitored: false, movies: [], qualityProfileId: 1, rootFolderPath: '/movies', minimumAvailability: 'released', ...extra,
});

async function add(body: Record<string, unknown>) {
  return POST(new NextRequest('http://helprr.test/api/radarr/collections', {
    method: 'POST',
    body: JSON.stringify({ collectionId: 7, tmdbId: 42, ...body }),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = ADMIN;
  mocks.client.lookupMovie.mockResolvedValue([{ tmdbId: 42, title: 'Second', year: 2020, titleSlug: 'second-42', images: [] }]);
  mocks.client.addMovie.mockResolvedValue({ id: 99 });
});

describe('POST /api/radarr/collections', () => {
  it.each([true, false])('searches on add only when the collection says so (%s), with its tags', async (searchOnAdd) => {
    mocks.client.getCollections.mockResolvedValue([collection({ searchOnAdd, tags: [4, 5] })]);
    expect((await add({})).status).toBe(200);
    expect(mocks.client.addMovie).toHaveBeenCalledWith(expect.objectContaining({
      tags: [4, 5],
      addOptions: { searchForMovie: searchOnAdd, monitor: 'movieOnly' },
    }));
  });

  it('adds with no tags when the collection has none', async () => {
    mocks.client.getCollections.mockResolvedValue([collection({ searchOnAdd: false })]);
    await add({});
    expect(mocks.client.addMovie).toHaveBeenCalledWith(expect.objectContaining({ tags: [] }));
  });

  it('refuses a collection it cannot find', async () => {
    mocks.client.getCollections.mockResolvedValue([]);
    expect((await add({})).status).toBe(400);
    expect(mocks.client.addMovie).not.toHaveBeenCalled();
  });
});

describe('PUT /api/radarr/collections', () => {
  const COLLECTION = collection({ searchOnAdd: false, tags: [4], movies: [{ tmdbId: 1 }] });

  async function edit(body: Record<string, unknown>) {
    return PUT(new NextRequest('http://helprr.test/api/radarr/collections', {
      method: 'PUT',
      body: JSON.stringify({ collectionId: 7, instanceId: 'r1', ...body }),
    }));
  }

  beforeEach(() => {
    mocks.client.getQualityProfiles.mockResolvedValue([{ id: 1, name: 'Any' }, { id: 4, name: 'HD' }]);
    mocks.client.getRootFolders.mockResolvedValue([{ id: 1, path: '/movies' }, { id: 2, path: '/archive/' }]);
    mocks.client.getTags.mockResolvedValue([{ id: 4, label: 'kids' }, { id: 5, label: '4k' }]);
    mocks.client.updateCollections.mockResolvedValue([]);
    mocks.client.getCollection.mockResolvedValue(COLLECTION);
    mocks.client.updateCollection.mockImplementation(async (c: unknown) => c);
  });

  it('sends the options it allows to the bulk update, and nothing else from the body', async () => {
    const res = await edit({
      monitorMovies: false, qualityProfileId: 4, minimumAvailability: 'inCinemas', searchOnAdd: true,
      rootFolderPath: '/archive', title: 'Renamed', movies: [], monitorNewItems: 'all',
    });
    expect(res.status).toBe(200);
    expect(mocks.client.updateCollections).toHaveBeenCalledWith({
      collectionIds: [7], monitorMovies: false, qualityProfileId: 4, minimumAvailability: 'inCinemas', searchOnAdd: true,
      // The instance's own spelling of the folder.
      rootFolderPath: '/archive/',
    });
    expect(mocks.client.updateCollection).not.toHaveBeenCalled();
  });

  it("keeps the drawer's monitoring switch working on its own", async () => {
    expect((await edit({ monitored: true })).status).toBe(200);
    expect(mocks.client.updateCollections).toHaveBeenCalledWith({ collectionIds: [7], monitored: true });
  });

  it("changes tags through the single-collection PUT, which Radarr's bulk update lacks", async () => {
    expect((await edit({ tags: [5, 5] })).status).toBe(200);
    expect(mocks.client.updateCollections).not.toHaveBeenCalled();
    expect(mocks.client.updateCollection).toHaveBeenCalledWith({ ...COLLECTION, tags: [5] });
  });

  it('clears tags without looking them up', async () => {
    expect((await edit({ tags: [] })).status).toBe(200);
    expect(mocks.client.getTags).not.toHaveBeenCalled();
    expect(mocks.client.updateCollection).toHaveBeenCalledWith({ ...COLLECTION, tags: [] });
  });

  it.each([
    ['no collection id', { collectionId: 0 }],
    ['nothing to change', {}],
    ['only fields it does not allow', { title: 'x', qualityProfile: { id: 1 } }],
    ['a monitored string', { monitored: 'false' }],
    ['a searchOnAdd number', { searchOnAdd: 1 }],
    ['a fractional profile id', { qualityProfileId: 1.5 }],
    ['a profile the instance lacks', { qualityProfileId: 9 }],
    ['an unknown availability', { minimumAvailability: 'tba' }],
    ['a folder that is not a root folder', { rootFolderPath: '/etc' }],
    ['a folder below a root folder', { rootFolderPath: '/movies/sub' }],
    ['an empty folder', { rootFolderPath: '' }],
    ['a tag the instance lacks', { tags: [4, 9] }],
    ['tags that are not ids', { tags: ['kids'] }],
  ])('refuses %s before anything reaches Radarr', async (_label, body) => {
    expect((await edit(body)).status).toBe(400);
    expect(mocks.client.updateCollections).not.toHaveBeenCalled();
    expect(mocks.client.updateCollection).not.toHaveBeenCalled();
  });

  it('needs movies.view to edit at all', async () => {
    mocks.user = member({ 'movies.view': false, 'movies.editMonitoring': true });
    expect((await edit({ monitored: true })).status).toBe(403);
  });

  it.each([
    ['monitored', { monitored: true }, 'movies.editMonitoring'],
    ['monitorMovies', { monitorMovies: true }, 'movies.editMonitoring'],
    ['tags', { tags: [5] }, 'movies.editTags'],
    ['rootFolderPath', { rootFolderPath: '/archive' }, 'movies.changePath'],
  ])("gates a member's %s change on %s", async (_field, body, cap) => {
    mocks.user = member({ 'movies.view': true, 'movies.editMonitoring': false, 'movies.editTags': false, 'movies.changePath': false });
    const refused = await edit(body);
    expect(refused.status).toBe(403);
    expect((await refused.json()).error).toContain(cap);

    mocks.user = member({ 'movies.view': true, 'movies.editMonitoring': false, 'movies.editTags': false, 'movies.changePath': false, [cap]: true });
    expect((await edit(body)).status).toBe(200);
  });

  it.each([
    ['qualityProfileId', { qualityProfileId: 4 }],
    ['minimumAvailability', { minimumAvailability: 'announced' }],
    ['searchOnAdd', { searchOnAdd: true }],
  ])("keeps %s admin-only, even alongside a field the member may change", async (_field, body) => {
    mocks.user = member({ 'movies.view': true, 'movies.editMonitoring': true, 'movies.editTags': true, 'movies.changePath': true });
    expect((await edit({ monitored: true, ...body })).status).toBe(403);
    expect(mocks.client.updateCollections).not.toHaveBeenCalled();
  });

  it('drops the collections cache even when the tags write fails after the bulk one', async () => {
    const { invalidateTaggedLibrary } = await import('@/lib/cache/tagged-library');
    mocks.client.updateCollection.mockRejectedValue(new Error('upstream'));
    expect((await edit({ searchOnAdd: true, tags: [5] })).status).toBe(500);
    expect(mocks.client.updateCollections).toHaveBeenCalledTimes(1);
    expect(invalidateTaggedLibrary).toHaveBeenCalledWith('radarr', 'r1');
  });
});
