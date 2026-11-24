import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  client: {
    getCollections: vi.fn(),
    lookupMovie: vi.fn(),
    addMovie: vi.fn(),
    getQualityProfiles: vi.fn(),
    getRootFolders: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  requireUserCapability: vi.fn(async () => ({ ok: true, user: { id: 'u1', role: 'admin', template: 'admin', permissions: {} } })),
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/service-helpers', () => ({ getRadarrClient: vi.fn(async () => mocks.client), getRadarrClients: vi.fn() }));
vi.mock('@/lib/arr-instances', () => ({ resolveConnection: vi.fn() }));
vi.mock('@/lib/cache/json-cache', () => ({ getCachedJson: vi.fn(async () => null) }));
vi.mock('@/lib/cache/tagged-library', () => ({ getCachedTaggedLibrary: vi.fn(), invalidateTaggedLibrary: vi.fn() }));

import { POST } from './route';

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
