import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  add: vi.fn(),
  client: vi.fn(),
  save: vi.fn(),
}));

vi.mock('@/lib/service-helpers', () => ({ getJellyfinClient: mocks.client }));
vi.mock('@/lib/archive/library', async (original) => ({
  ...await original<typeof import('@/lib/archive/library')>(),
  readLibraryStatus: mocks.status,
}));

import { libraryStatusResponse, linkLibrary } from './library-route';

const missing = { exists: false, itemId: null, name: null, pathMatches: false, fetchersOff: false, conflicts: [] as string[] };
const found = { ...missing, exists: true, itemId: 'library-id', name: 'YouTube (dev)', pathMatches: true, fetchersOff: true };
const post = (body: unknown) => new NextRequest('http://test/api/youtube/library', {
  method: 'POST',
  body: JSON.stringify(body),
  headers: { 'content-type': 'application/json' },
});
const good = { name: 'YouTube (dev)', path: '/mnt/exos22/youtube-dev' };

describe('the Jellyfin library routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.client.mockResolvedValue({ addVirtualFolder: mocks.add });
    mocks.save.mockResolvedValue(undefined);
  });

  it('reports nothing configured without asking Jellyfin', async () => {
    expect(await (await libraryStatusResponse(null)).json()).toEqual({ configured: false });
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it('says so when Jellyfin cannot be reached', async () => {
    mocks.client.mockRejectedValue(new Error('refused'));
    expect((await libraryStatusResponse('/mnt/exos22/youtube-dev')).status).toBe(502);
  });

  it('creates a Shows library with every internet fetcher off, and saves it', async () => {
    mocks.status.mockResolvedValueOnce(missing).mockResolvedValueOnce(found);

    const response = await linkLibrary(post(good), mocks.save);

    expect(response.status).toBe(200);
    const [name, type, options] = mocks.add.mock.calls[0];
    expect([name, type]).toEqual(['YouTube (dev)', 'tvshows']);
    expect(options.EnableInternetProviders).toBe(false);
    expect(options.PathInfos).toEqual([{ Path: good.path }]);
    expect(mocks.save).toHaveBeenCalledWith({ jellyfinLibraryPath: good.path, jellyfinLibraryItemId: 'library-id' });
  });

  it('links a library that already points at the folder, without creating another', async () => {
    mocks.status.mockResolvedValue(found);
    expect((await linkLibrary(post(good), mocks.save)).status).toBe(200);
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.save).toHaveBeenCalled();
  });

  it('leaves Jellyfin alone when another library already covers the folder', async () => {
    mocks.status.mockResolvedValue({ ...missing, conflicts: ['Shows'] });
    const response = await linkLibrary(post(good), mocks.save);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Already covered by Shows' });
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each([
    ['a relative path', { ...good, path: 'mnt/youtube' }],
    ['a path that climbs out', { ...good, path: '/mnt/exos22/../etc' }],
    ['no name', { ...good, name: '' }],
    ['a name with symbols', { ...good, name: 'a/b' }],
    ['nothing useful', null],
  ])('refuses %s before reaching Jellyfin', async (_label, body) => {
    expect((await linkLibrary(post(body), mocks.save)).status).toBe(400);
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it('saves nothing when Jellyfin refuses', async () => {
    mocks.status.mockResolvedValue(missing);
    mocks.add.mockRejectedValue(new Error('refused'));
    expect((await linkLibrary(post(good), mocks.save)).status).toBe(502);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
