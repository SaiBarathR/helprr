import { NextRequest, NextResponse } from 'next/server';
import { AxiosError, AxiosHeaders } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireUserCapability: vi.fn(),
  bump: vi.fn(),
  log: vi.fn(),
  qbit: {
    getCategories: vi.fn(),
    getDefaultSavePath: vi.fn(),
    isSubcategoriesEnabled: vi.fn(),
    getSavePathPreferences: vi.fn(),
    createCategory: vi.fn(),
    editCategory: vi.fn(),
    removeCategories: vi.fn(),
  },
  sonarr: [] as Array<{ connection: { label: string }; client: { getDownloadClients: ReturnType<typeof vi.fn> } }>,
  radarr: [] as Array<{ connection: { label: string }; client: { getDownloadClients: ReturnType<typeof vi.fn> } }>,
  lidarr: [] as Array<{ connection: { label: string }; client: { getDownloadClients: ReturnType<typeof vi.fn> } }>,
}));

vi.mock('@/lib/auth', () => ({ requireAdmin: mocks.requireAdmin, requireUserCapability: mocks.requireUserCapability }));
vi.mock('@/lib/service-helpers', () => ({
  getQBittorrentClient: vi.fn().mockResolvedValue(mocks.qbit),
  getSonarrClients: vi.fn(async () => mocks.sonarr),
  getRadarrClients: vi.fn(async () => mocks.radarr),
  getLidarrClients: vi.fn(async () => mocks.lidarr),
}));
vi.mock('@/lib/cache/qbittorrent-version', () => ({ bumpQbitCacheVersion: mocks.bump }));
vi.mock('@/lib/logger', () => ({ logger: { info: mocks.log, warn: mocks.log, error: mocks.log } }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));

import { DELETE, GET, PATCH, POST } from '@/app/api/qbittorrent/categories/route';

const ADMIN = { id: 'u1', username: 'admin', role: 'admin' };
const FORBIDDEN = { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };

const request = (method: string, body: unknown) =>
  new NextRequest('http://localhost/api/qbittorrent/categories', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const create = (body: unknown) => POST(request('POST', body));
const edit = (body: unknown) => PATCH(request('PATCH', body));
const remove = (body: unknown) => DELETE(request('DELETE', body));

const qbitClient = (category: string, extra: Record<string, unknown> = {}) => ({
  name: 'qBittorrent',
  implementation: 'QBittorrent',
  fields: [{ name: 'host', value: 'qbt' }, { name: 'tvCategory', value: category }, ...Object.entries(extra).map(([name, value]) => ({ name, value }))],
});
const arr = (label: string, clients: unknown) => ({
  connection: { label },
  client: { getDownloadClients: vi.fn(async () => clients) },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ ok: true, user: ADMIN, session: {} });
  mocks.requireUserCapability.mockResolvedValue({ ok: true, user: ADMIN, session: {} });
  mocks.qbit.getDefaultSavePath.mockResolvedValue('/downloads');
  mocks.qbit.isSubcategoriesEnabled.mockResolvedValue(false);
  mocks.qbit.getSavePathPreferences.mockResolvedValue({
    subcategories: false, autoTmmByDefault: false, categoryPathsInManualMode: false, relocateOnCategoryPathChange: false,
  });
  mocks.qbit.getCategories.mockResolvedValue({
    tv: { name: 'tv', savePath: '/downloads/tv' },
    movies: { name: 'movies', savePath: '/data/movies', download_path: '/downloads/incomplete' },
    '../escape': { name: '../escape', savePath: '' },
  });
  mocks.sonarr = [];
  mocks.radarr = [];
  mocks.lidarr = [];
});

describe('who may change categories', () => {
  it.each([
    ['create', () => create({ name: 'anime' })],
    ['edit', () => edit({ name: 'tv', savePath: '/downloads/shows' })],
    ['remove', () => remove({ categories: ['tv'] })],
  ])('refuses a member who tries to %s one', async (_label, call) => {
    mocks.requireAdmin.mockResolvedValue(FORBIDDEN);
    const res = await call();
    expect(res.status).toBe(403);
    expect(mocks.qbit.createCategory).not.toHaveBeenCalled();
    expect(mocks.qbit.editCategory).not.toHaveBeenCalled();
    expect(mocks.qbit.removeCategories).not.toHaveBeenCalled();
    expect(mocks.bump).not.toHaveBeenCalled();
  });

  it('still lets anyone who may view torrents list them', async () => {
    const res = await GET(new NextRequest('http://localhost/api/qbittorrent/categories'));
    expect(res.status).toBe(200);
    expect(Object.keys(await res.json())).toEqual(['tv', 'movies', '../escape']);
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('torrents.view');
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
  });

  it('adds the default save path and where torrents save for the Categories screen and the add page', async () => {
    const res = await GET(new NextRequest('http://localhost/api/qbittorrent/categories?details=1'));
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual([
      'autoTmmByDefault', 'categories', 'categoryPathsInManualMode', 'defaultSavePath', 'relocateOnCategoryPathChange', 'subcategories',
    ]);
    expect(body).toEqual(expect.objectContaining({ defaultSavePath: '/downloads', subcategories: false, relocateOnCategoryPathChange: false }));
  });
});

describe('creating a category', () => {
  it('creates one with qBittorrent\'s default folder, bumps the cache and logs who did it', async () => {
    const res = await create({ name: ' anime ', savePath: '' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, name: 'anime' });
    expect(mocks.qbit.createCategory).toHaveBeenCalledWith('anime', '');
    expect(mocks.bump).toHaveBeenCalledTimes(1);
    expect(mocks.log).toHaveBeenCalledWith(
      'qBittorrent category created',
      expect.objectContaining({ username: 'admin', category: 'anime', savePath: '' }),
      expect.anything(),
    );
  });

  it('creates one with a folder inside the default save path', async () => {
    expect((await create({ name: 'anime', savePath: ' /downloads/anime ' })).status).toBe(200);
    expect(mocks.qbit.createCategory).toHaveBeenCalledWith('anime', '/downloads/anime');
  });

  it.each([
    ['a parent hop', '../escape'],
    ['a parent hop inside', 'a/../../x'],
    ['only dots', '...'],
    ['a dot-and-space part Windows reads as ..', '.. /x'],
    ['a backslash', 'a\\b'],
    ['a leading slash', '/tv'],
    ['a trailing slash', 'tv/'],
    ['a double slash', 'a//b'],
    ['a control character', 'a\u0000b'],
    ['a newline', 'a\nb'],
    ['U+0085', 'a\u0085b'],
    ['nothing', '  '],
    ['no string', 7],
    ['101 characters', 'x'.repeat(101)],
  ])('refuses a name with %s', async (_label, name) => {
    mocks.qbit.isSubcategoriesEnabled.mockResolvedValue(true);
    const res = await create({ name });
    expect(res.status).toBe(400);
    // The form shows it under the name.
    expect((await res.json()).field).toBe('name');
    expect(mocks.qbit.createCategory).not.toHaveBeenCalled();
    expect(mocks.bump).not.toHaveBeenCalled();
  });

  it('names the parent hop, not subcategory mode, when both apply', async () => {
    const res = await create({ name: '../escape' });
    expect((await res.json()).error).toMatch(/dots/);
  });

  it('allows a subcategory only in qBittorrent\'s subcategory mode', async () => {
    const off = await create({ name: 'tv/anime' });
    expect(off.status).toBe(400);
    expect((await off.json()).error).toMatch(/subcategories/);
    mocks.qbit.isSubcategoriesEnabled.mockResolvedValue(true);
    expect((await create({ name: 'tv/anime' })).status).toBe(200);
    expect(mocks.qbit.createCategory).toHaveBeenCalledWith('tv/anime', '');
  });

  it.each([
    ['outside the default save path', '/etc'],
    ['in a sibling that only shares a prefix', '/downloads-other/x'],
    ['inside another category\'s folder outside the default', '/data/movies/more'],
    ['through a parent hop', '/downloads/../etc'],
    ['relative', 'anime'],
  ])('refuses a save path %s', async (_label, savePath) => {
    const res = await create({ name: 'anime', savePath });
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('savePath');
    expect(mocks.qbit.createCategory).not.toHaveBeenCalled();
  });

  it('refuses a name already taken', async () => {
    const res = await create({ name: 'tv' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'There is already a category named tv', field: 'name' });
    expect(mocks.qbit.createCategory).not.toHaveBeenCalled();
  });

  it('passes on qBittorrent refusing it', async () => {
    mocks.qbit.createCategory.mockRejectedValue(
      new AxiosError('conflict', '409', undefined, undefined, {
        status: 409, statusText: 'Conflict', data: 'Unable to create category', headers: {}, config: { headers: new AxiosHeaders() },
      }),
    );
    const res = await create({ name: 'anime' });
    expect(res.status).toBe(409);
    expect((await res.json()).field).toBe('name');
    expect(mocks.bump).not.toHaveBeenCalled();
  });
});

describe('editing a category', () => {
  it('changes the save path and sends its own download path back unchanged', async () => {
    const res = await edit({ name: 'movies', savePath: '/downloads/movies' });
    expect(res.status).toBe(200);
    expect(mocks.qbit.editCategory).toHaveBeenCalledWith('movies', '/downloads/movies', '/downloads/incomplete');
    expect(mocks.bump).toHaveBeenCalledTimes(1);
  });

  it('keeps a present save path outside the default save path', async () => {
    expect((await edit({ name: 'movies', savePath: '/data/movies' })).status).toBe(200);
    expect(mocks.qbit.editCategory).toHaveBeenCalledWith('movies', '/data/movies', '/downloads/incomplete');
  });

  it('refuses moving it outside the default save path', async () => {
    const res = await edit({ name: 'tv', savePath: '/etc' });
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe('savePath');
    expect(mocks.qbit.editCategory).not.toHaveBeenCalled();
  });

  it('refuses a category qBittorrent does not have', async () => {
    for (const name of ['nope', 'constructor', '__proto__']) {
      expect((await edit({ name, savePath: '' })).status).toBe(404);
    }
    expect(mocks.qbit.editCategory).not.toHaveBeenCalled();
  });

  it('needs the name and the save path, so a left-out path never resets it', async () => {
    expect((await edit({ name: 'tv' })).status).toBe(400);
    expect((await edit({ name: 7, savePath: '' })).status).toBe(400);
    expect(mocks.qbit.editCategory).not.toHaveBeenCalled();
  });

  it('refuses the default folder for a name made elsewhere that would leave the download folders', async () => {
    mocks.qbit.getCategories.mockResolvedValue({ '../escape': { name: '../escape', savePath: '/downloads/escape' } });
    expect((await edit({ name: '../escape', savePath: '' })).status).toBe(400);
    expect(mocks.qbit.editCategory).not.toHaveBeenCalled();
    // Its own folder inside the default save path stays allowed, and so does removing it.
    expect((await edit({ name: '../escape', savePath: '/downloads/escape2' })).status).toBe(200);
  });

  it('refuses a save path with a backslash on a Linux qBittorrent', async () => {
    expect((await edit({ name: 'tv', savePath: '/downloads\\x' })).status).toBe(400);
    expect(mocks.qbit.editCategory).not.toHaveBeenCalled();
  });
});

describe('removing categories', () => {
  it('removes several at once', async () => {
    const res = await remove({ categories: ['tv', '../escape', 'tv'] });
    expect(res.status).toBe(200);
    expect(mocks.qbit.removeCategories).toHaveBeenCalledWith(['tv', '../escape']);
    expect(mocks.bump).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['none', []],
    ['no list', 'tv'],
    ['a newline', ['tv\nmovies']],
    ['an empty name', ['']],
    ['51 of them', Array.from({ length: 51 }, (_, i) => `c${i}`)],
  ])('refuses %s', async (_label, categories) => {
    expect((await remove({ categories })).status).toBe(400);
    expect(mocks.qbit.removeCategories).not.toHaveBeenCalled();
  });

  it('refuses one qBittorrent does not have', async () => {
    expect((await remove({ categories: ['tv', 'nope'] })).status).toBe(404);
    expect(mocks.qbit.removeCategories).not.toHaveBeenCalled();
  });

  it('asks for a confirm when an arr download client uses it, naming which', async () => {
    mocks.sonarr = [arr('Sonarr Anime', [qbitClient('tv'), { name: 'SAB', implementation: 'Sabnzbd', fields: [{ name: 'tvCategory', value: 'movies' }] }])];
    mocks.radarr = [arr('Radarr', [qbitClient('other', { movieImportedCategory: 'movies' })])];
    const res = await remove({ categories: ['tv', 'movies'] });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.needsConfirm).toBe(true);
    expect(body.uses).toEqual([
      { app: 'Sonarr', instance: 'Sonarr Anime', downloadClient: 'qBittorrent', category: 'tv' },
      { app: 'Radarr', instance: 'Radarr', downloadClient: 'qBittorrent', category: 'movies' },
    ]);
    expect(mocks.qbit.removeCategories).not.toHaveBeenCalled();
    expect(mocks.bump).not.toHaveBeenCalled();
  });

  it('counts a subcategory an arr uses when subcategory mode removes it too', async () => {
    mocks.lidarr = [arr('Lidarr', [qbitClient('tv/music')])];
    expect((await remove({ categories: ['tv'] })).status).toBe(200);
    mocks.qbit.isSubcategoriesEnabled.mockResolvedValue(true);
    expect((await remove({ categories: ['tv'] })).status).toBe(409);
  });

  it('skips other download clients and empty or non-category fields', async () => {
    mocks.sonarr = [arr('Sonarr', [
      { name: 'Deluge', implementation: 'Deluge', fields: [{ name: 'tvCategory', value: 'tv' }] },
      qbitClient('', { tvImportedCategory: '', host: 'tv', urlBase: 'tv' }),
    ])];
    expect((await remove({ categories: ['tv'] })).status).toBe(200);
  });

  it('counts a qBittorrent client whose settings can\'t be read as unchecked', async () => {
    mocks.radarr = [arr('Radarr', [{ name: 'qBittorrent', implementation: 'QBittorrent', fields: { tvCategory: 'tv' } }, null])];
    const res = await remove({ categories: ['tv'] });
    expect(res.status).toBe(409);
    expect((await res.json()).unchecked).toEqual(['Radarr']);
  });

  it('asks for a confirm when an arr instance does not answer', async () => {
    mocks.sonarr = [{ connection: { label: 'Sonarr' }, client: { getDownloadClients: vi.fn().mockRejectedValue(new Error('down')) } }];
    const res = await remove({ categories: ['tv'] });
    expect(res.status).toBe(409);
    expect((await res.json()).unchecked).toEqual(['Sonarr']);
  });

  it('removes it after the confirm and logs the uses it was told of', async () => {
    mocks.sonarr = [arr('Sonarr', [qbitClient('tv')])];
    const res = await remove({ categories: ['tv'], confirm: true });
    expect(res.status).toBe(200);
    expect(mocks.qbit.removeCategories).toHaveBeenCalledWith(['tv']);
    expect(mocks.bump).toHaveBeenCalledTimes(1);
    expect(mocks.log).toHaveBeenCalledWith(
      'qBittorrent categories removed',
      expect.objectContaining({ categories: ['tv'], confirmedArrUses: [expect.objectContaining({ category: 'tv' })] }),
      expect.anything(),
    );
  });

  it('only counts a confirm of true', async () => {
    mocks.sonarr = [arr('Sonarr', [qbitClient('tv')])];
    expect((await remove({ categories: ['tv'], confirm: 'yes' })).status).toBe(409);
    expect(mocks.qbit.removeCategories).not.toHaveBeenCalled();
  });
});
