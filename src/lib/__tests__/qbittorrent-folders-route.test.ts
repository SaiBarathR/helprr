import { NextRequest, NextResponse } from 'next/server';
import { AxiosError, AxiosHeaders } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireAuth: vi.fn(),
  requireUserCapability: vi.fn(),
  qbit: {
    getCategories: vi.fn(),
    getDefaultSavePath: vi.fn(),
    getDirectoryContent: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  requireAdmin: mocks.requireAdmin,
  requireAuth: mocks.requireAuth,
  requireUserCapability: mocks.requireUserCapability,
}));
vi.mock('@/lib/service-helpers', () => ({ getQBittorrentClient: vi.fn().mockResolvedValue(mocks.qbit) }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));

import { GET } from '@/app/api/qbittorrent/folders/route';

const USER = { id: 'u1', username: 'member', role: 'user' };
const FORBIDDEN = { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };

const list = (purpose: string, path?: string) => {
  const params = new URLSearchParams({ for: purpose });
  if (path !== undefined) params.set('path', path);
  return GET(new NextRequest(`http://localhost/api/qbittorrent/folders?${params}`));
};

const notFound = (data: string) => new AxiosError('404', 'ERR_BAD_REQUEST', undefined, undefined, {
  status: 404, statusText: 'Not Found', data, headers: {}, config: { headers: new AxiosHeaders() },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(null);
  mocks.requireAdmin.mockResolvedValue({ ok: true, user: { ...USER, role: 'admin' }, session: {} });
  mocks.requireUserCapability.mockResolvedValue({ ok: true, user: USER, session: {} });
  mocks.qbit.getDefaultSavePath.mockResolvedValue('/downloads');
  mocks.qbit.getCategories.mockResolvedValue({
    tv: { name: 'tv', savePath: '/downloads/tv' },
    movies: { name: 'movies', savePath: '/data/movies/' },
    relative: { name: 'relative', savePath: 'relative/path' },
    plain: { name: 'plain', savePath: '' },
  });
  mocks.qbit.getDirectoryContent.mockResolvedValue([]);
});

describe('who may list folders', () => {
  it.each([
    ['add', 'torrents.add'],
    ['location', 'torrents.manage'],
  ])('asks for the grant the %s field needs', async (purpose, capability) => {
    mocks.requireUserCapability.mockResolvedValue(FORBIDDEN);
    const res = await list(purpose, '/downloads');
    expect(res.status).toBe(403);
    expect(mocks.requireUserCapability).toHaveBeenCalledWith(capability);
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
    expect(mocks.qbit.getDirectoryContent).not.toHaveBeenCalled();
  });

  it("keeps a category's folders to an admin", async () => {
    mocks.requireAdmin.mockResolvedValue(FORBIDDEN);
    const res = await list('category', '/downloads');
    expect(res.status).toBe(403);
    expect(mocks.requireUserCapability).not.toHaveBeenCalled();
    expect(mocks.qbit.getDirectoryContent).not.toHaveBeenCalled();
  });

  it('refuses an unknown picker after checking the session', async () => {
    const res = await list('anything', '/downloads');
    expect(res.status).toBe(400);
    expect(mocks.requireAuth).toHaveBeenCalled();
    expect(mocks.qbit.getDirectoryContent).not.toHaveBeenCalled();

    mocks.requireAuth.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    expect((await list('__proto__')).status).toBe(401);
  });
});

describe('where it lists', () => {
  it('starts from the download folders: absolute ones only, without repeats', async () => {
    mocks.qbit.getCategories.mockResolvedValue({
      tv: { name: 'tv', savePath: '/downloads/tv' },
      again: { name: 'again', savePath: '/downloads/' },
      movies: { name: 'movies', savePath: '/data/movies/' },
      relative: { name: 'relative', savePath: 'relative/path' },
      plain: { name: 'plain', savePath: '' },
    });
    const res = await list('add');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      path: null,
      parent: null,
      folders: ['/data/movies', '/downloads', '/downloads/tv'],
      total: 3,
      truncated: false,
    });
    expect(mocks.qbit.getDirectoryContent).not.toHaveBeenCalled();
  });

  it("offers a category only qBittorrent's default save path", async () => {
    const res = await list('category');
    expect((await res.json()).folders).toEqual(['/downloads']);
    expect(mocks.qbit.getCategories).not.toHaveBeenCalled();
  });

  it.each([
    ['above a root', '/'],
    ['beside a root', '/downloads-other'],
    ['up and out with ..', '/downloads/../etc'],
    ['.. at the end', '/downloads/tv/..'],
    ['.. hidden by a trailing U+0085', '/downloads/..\u0085'],
    ['dots and spaces', '/downloads/.. /x'],
    ['three dots', '/downloads/...'],
    ['a backslash on Linux', '/downloads\\..\\etc'],
    ['a backslash inside a name', '/downloads/a\\b'],
    ['a control character', '/downloads/a\u0000b'],
    ['a relative path', 'downloads/tv'],
    ['a relative category path', 'relative/path/x'],
  ])('refuses a folder %s', async (_label, path) => {
    const res = await list('add', path);
    expect(res.status).toBe(400);
    expect(mocks.qbit.getDirectoryContent).not.toHaveBeenCalled();
  });

  it("keeps a category's picker inside the default save path, not other categories' folders", async () => {
    expect((await list('category', '/data/movies')).status).toBe(400);
    expect((await list('add', '/data/movies')).status).toBe(200);
    expect(mocks.qbit.getDirectoryContent).toHaveBeenCalledTimes(1);
  });

  it('asks qBittorrent for the folder as it was checked', async () => {
    await list('location', '  /downloads/tv/  ');
    expect(mocks.qbit.getDirectoryContent).toHaveBeenCalledWith('/downloads/tv');
  });

  it('lists a folder typed with "." or "//" as qBittorrent cleans it', async () => {
    mocks.qbit.getDirectoryContent.mockResolvedValue(['/downloads/tv/Anime']);
    for (const typed of ['/downloads/./tv', '/downloads//tv/.']) {
      const body = await (await list('add', typed)).json();
      expect(body).toMatchObject({ path: '/downloads/tv', parent: '/downloads', folders: ['Anime'] });
    }
    expect(mocks.qbit.getDirectoryContent).toHaveBeenLastCalledWith('/downloads/tv');
  });

  it('keeps a bare drive root a drive, not its working folder', async () => {
    mocks.qbit.getDefaultSavePath.mockResolvedValue('D:\\');
    mocks.qbit.getCategories.mockResolvedValue({});
    expect((await (await list('add')).json()).folders).toEqual(['D:/']);

    mocks.qbit.getDirectoryContent.mockResolvedValue(['D:/Media', 'D:/Games']);
    const top = await (await list('add', 'D:\\')).json();
    expect(mocks.qbit.getDirectoryContent).toHaveBeenLastCalledWith('D:/');
    expect(top).toMatchObject({ path: 'D:/', parent: null, folders: ['Games', 'Media'] });

    mocks.qbit.getDirectoryContent.mockResolvedValue([]);
    expect(await (await list('add', 'D:/Media')).json()).toMatchObject({ path: 'D:/Media', parent: 'D:/' });
  });

  it('reads a Windows root as Windows does', async () => {
    mocks.qbit.getDefaultSavePath.mockResolvedValue('D:\\Downloads');
    mocks.qbit.getCategories.mockResolvedValue({});
    mocks.qbit.getDirectoryContent.mockResolvedValue(['D:/Downloads/TV/Anime', 'D:\\Downloads\\TV\\Kids']);
    const res = await list('add', 'D:\\Downloads\\TV');
    expect(mocks.qbit.getDirectoryContent).toHaveBeenCalledWith('D:/Downloads/TV');
    expect(await res.json()).toMatchObject({ path: 'D:/Downloads/TV', parent: 'D:/Downloads', folders: ['Anime', 'Kids'] });
    expect((await list('add', 'D:\\Downloads\\..\\Windows')).status).toBe(400);
  });
});

describe('what it answers', () => {
  it('names the folders, sorted, leaving out what a save path could not name', async () => {
    mocks.qbit.getDirectoryContent.mockResolvedValue([
      '/downloads/tv/zeta',
      '/downloads/tv/Alpha',
      '/downloads/tv/Season 10',
      '/downloads/tv/Season 2',
      '/downloads/tv/back\\slash',
      '/downloads/tv/...',
      '/downloads/tv/trailing ',
      '/downloads/tv/ctrl\u0007',
      '/downloads/tv/a/b',
      '/etc',
      '/downloads/tvx/other',
      42,
      '/downloads/tv/Alpha',
    ]);
    const res = await list('add', '/downloads/tv');
    expect(await res.json()).toEqual({
      path: '/downloads/tv',
      parent: '/downloads',
      folders: ['Alpha', 'Season 2', 'Season 10', 'zeta'],
      total: 4,
      truncated: false,
    });
  });

  it('goes no higher than a download folder', async () => {
    mocks.qbit.getDirectoryContent.mockResolvedValue([]);
    expect((await (await list('add', '/downloads')).json()).parent).toBeNull();
    expect((await (await list('add', '/data/movies')).json()).parent).toBeNull();
    // A category's picker stops at the default save path even where a category's folder sits above.
    expect((await (await list('category', '/downloads/tv')).json()).parent).toBe('/downloads');
  });

  it('caps a long list and says so', async () => {
    mocks.qbit.getDirectoryContent.mockResolvedValue(
      Array.from({ length: 620 }, (_, index) => `/downloads/folder ${String(index).padStart(3, '0')}`),
    );
    const body = await (await list('add', '/downloads')).json();
    expect(body.folders).toHaveLength(500);
    expect(body.folders[0]).toBe('folder 000');
    expect(body).toMatchObject({ total: 620, truncated: true });
  });

  it('tells a missing folder from a qBittorrent that cannot list', async () => {
    mocks.qbit.getDirectoryContent.mockRejectedValueOnce(notFound('Directory does not exist'));
    const gone = await list('add', '/downloads/gone');
    expect(gone.status).toBe(404);
    expect((await gone.json()).error).toBe('That folder is not there anymore');

    mocks.qbit.getDirectoryContent.mockRejectedValueOnce(notFound('Not Found'));
    const old = await list('add', '/downloads');
    expect(old.status).toBe(404);
    expect((await old.json()).error).toMatch(/can't list folders/);
  });

  it('fails closed on an answer that is not a list', async () => {
    mocks.qbit.getDirectoryContent.mockResolvedValue({ '/downloads/x': true });
    expect((await list('add', '/downloads')).status).toBe(500);
  });
});
