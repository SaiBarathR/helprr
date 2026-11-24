import { NextRequest, NextResponse } from 'next/server';
import { AxiosError, AxiosHeaders } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUserCapability: vi.fn(),
  bump: vi.fn(),
  log: vi.fn(),
  qbit: {
    getTorrentFiles: vi.fn(),
    getTorrents: vi.fn(),
    renameFile: vi.fn(),
    renameFolder: vi.fn(),
  },
  sonarr: [] as Array<{ connection: { label: string }; client: { getDownloadClients: ReturnType<typeof vi.fn> } }>,
}));

vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.requireUserCapability }));
vi.mock('@/lib/service-helpers', () => ({
  getQBittorrentClient: vi.fn().mockResolvedValue(mocks.qbit),
  getSonarrClients: vi.fn(async () => mocks.sonarr),
  getRadarrClients: vi.fn(async () => []),
  getLidarrClients: vi.fn(async () => []),
}));
vi.mock('@/lib/cache/qbittorrent-version', () => ({ bumpQbitCacheVersion: mocks.bump }));
vi.mock('@/lib/logger', () => ({ logger: { info: mocks.log, warn: mocks.log, error: mocks.log } }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));

import { POST } from '@/app/api/qbittorrent/[hash]/files/rename/route';

const HASH = 'fc1a1cdbcb65005242f42dcf9347613d75dc8877';
const USER = { id: 'u1', username: 'member', role: 'user' };

const rename = (body: unknown, hash = HASH) =>
  POST(
    new NextRequest(`http://localhost/api/qbittorrent/${hash}/files/rename`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ hash }) },
  );

const conflict = () => new AxiosError('409', 'ERR_BAD_REQUEST', undefined, undefined, {
  status: 409, statusText: 'Conflict', data: 'The file already exists', headers: {}, config: { headers: new AxiosHeaders() },
});

const sonarrUsing = (category: string) => ({
  connection: { label: 'Sonarr Anime' },
  client: {
    getDownloadClients: vi.fn(async () => [
      { name: 'qBittorrent', implementation: 'QBittorrent', fields: [{ name: 'tvCategory', value: category }] },
    ]),
  },
});

const FILES = [
  'Pack/Season 01/Episode 01.mkv',
  'Pack/Season 01/Episode 02.mkv',
  'Pack/Season 02/Episode 01.mkv',
  'Pack/readme.txt',
].map((name, index) => ({ index, name, size: 1, progress: 1, priority: 1, is_seed: true, availability: 1 }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUserCapability.mockResolvedValue({ ok: true, user: USER, session: {} });
  mocks.qbit.getTorrentFiles.mockResolvedValue(FILES);
  mocks.qbit.getTorrents.mockResolvedValue([{ hash: HASH, name: 'Pack', category: '' }]);
  mocks.qbit.renameFile.mockResolvedValue(undefined);
  mocks.qbit.renameFolder.mockResolvedValue(undefined);
  mocks.sonarr = [];
});

const renamed = () => mocks.qbit.renameFile.mock.calls.length + mocks.qbit.renameFolder.mock.calls.length;

describe('who may rename', () => {
  it('needs torrents.manage', async () => {
    mocks.requireUserCapability.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
    const res = await rename({ kind: 'file', path: 'Pack/readme.txt', name: 'notes.txt' });
    expect(res.status).toBe(403);
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('torrents.manage');
    expect(mocks.qbit.getTorrentFiles).not.toHaveBeenCalled();
  });

  it.each(['all', `${HASH}|${HASH}`, 'zz'])('renames in one torrent only, not %s', async (hash) => {
    expect((await rename({ kind: 'file', path: 'Pack/readme.txt', name: 'x' }, hash)).status).toBe(400);
    expect(mocks.qbit.getTorrentFiles).not.toHaveBeenCalled();
  });
});

describe('the new name', () => {
  it.each([
    ['a path', 'Season 01/x.mkv'],
    ['a way up', '../escape.mkv'],
    ['a backslash', '..\\escape.mkv'],
    ['dots only', '..'],
    ['one dot', '.'],
    ['dots and spaces', ' . . '],
    ['an absolute path', '/etc/passwd'],
    ['a control character', 'a\u0000b'],
    ['nothing', '   '],
    ['too many bytes', 'é'.repeat(128)],
    ['no string', 42],
  ])('refuses %s', async (_label, name) => {
    const res = await rename({ kind: 'file', path: 'Pack/readme.txt', name });
    expect(res.status).toBe(400);
    expect(renamed()).toBe(0);
  });

  it('puts the name beside the old one, built on the server', async () => {
    const res = await rename({ kind: 'file', path: 'Pack/readme.txt', name: '  notes.txt  ' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, path: 'Pack/notes.txt' });
    expect(mocks.qbit.renameFile).toHaveBeenCalledWith(HASH, 'Pack/readme.txt', 'Pack/notes.txt');
    expect(mocks.bump).toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledWith(
      'Torrent file renamed',
      expect.objectContaining({ userId: 'u1', oldPath: 'Pack/readme.txt', newPath: 'Pack/notes.txt' }),
      { scope: 'qbittorrent' },
    );
  });

  it('renames a folder, the top one too', async () => {
    await rename({ kind: 'folder', path: 'Pack/Season 02', name: 'S02' });
    expect(mocks.qbit.renameFolder).toHaveBeenCalledWith(HASH, 'Pack/Season 02', 'Pack/S02');
    await rename({ kind: 'folder', path: 'Pack', name: 'The Pack' });
    expect(mocks.qbit.renameFolder).toHaveBeenLastCalledWith(HASH, 'Pack', 'The Pack');
  });

  it('allows a name with dots in it', async () => {
    expect((await rename({ kind: 'file', path: 'Pack/readme.txt', name: '...readme.v2.txt' })).status).toBe(200);
  });
});

describe('the old path', () => {
  it.each([
    ['a file the torrent lacks', 'file', 'Pack/other.txt'],
    ['a path out of the torrent', 'file', '../etc/passwd'],
    ['a folder named as a file', 'file', 'Pack/Season 01'],
    ['a file named as a folder', 'folder', 'Pack/readme.txt'],
    ['part of a folder name', 'folder', 'Pack/Season'],
    ['a folder with a trailing slash', 'folder', 'Pack/Season 01/'],
  ])('refuses %s', async (_label, kind, path) => {
    const res = await rename({ kind, path, name: 'x' });
    expect(res.status).toBe(404);
    expect(renamed()).toBe(0);
  });

  it.each([
    ['no kind', { path: 'Pack/readme.txt', name: 'x' }],
    ['another kind', { kind: 'torrent', path: 'Pack/readme.txt', name: 'x' }],
    ['no path', { kind: 'file', name: 'x' }],
    ['a control character', { kind: 'file', path: 'Pack/\u0007', name: 'x' }],
  ])('refuses %s', async (_label, body) => {
    expect((await rename(body)).status).toBe(400);
    expect(renamed()).toBe(0);
  });

  it('refuses a torrent qBittorrent no longer has', async () => {
    mocks.qbit.getTorrents.mockResolvedValue([]);
    expect((await rename({ kind: 'file', path: 'Pack/readme.txt', name: 'x' })).status).toBe(404);
    expect(renamed()).toBe(0);
  });
});

describe('a name that is taken', () => {
  it.each([
    ['a file', 'file', 'Pack/Season 01/Episode 02.mkv', 'Episode 01.mkv'],
    ['a folder by a file', 'file', 'Pack/readme.txt', 'Season 01'],
    ['a folder', 'folder', 'Pack/Season 02', 'Season 01'],
  ])('refuses %s', async (_label, kind, path, name) => {
    expect((await rename({ kind, path, name })).status).toBe(409);
    expect(renamed()).toBe(0);
  });

  it('refuses the same name', async () => {
    expect((await rename({ kind: 'file', path: 'Pack/readme.txt', name: 'readme.txt' })).status).toBe(400);
  });

  it("passes qBittorrent's own refusal on as a 409", async () => {
    mocks.qbit.renameFile.mockRejectedValue(conflict());
    const res = await rename({ kind: 'file', path: 'Pack/readme.txt', name: 'notes.txt' });
    expect(res.status).toBe(409);
    expect(mocks.bump).not.toHaveBeenCalled();
  });
});

describe('a torrent an arr downloads', () => {
  it('asks first when an arr uses its category, then renames once confirmed', async () => {
    mocks.qbit.getTorrents.mockResolvedValue([{ hash: HASH, name: 'Pack', category: 'tv' }]);
    mocks.sonarr = [sonarrUsing('tv')];

    const first = await rename({ kind: 'file', path: 'Pack/readme.txt', name: 'notes.txt' });
    expect(first.status).toBe(409);
    // A member is told which app, not the connection's label.
    expect(await first.json()).toMatchObject({
      needsConfirm: true,
      category: 'tv',
      uses: [{ app: 'Sonarr', instance: 'Sonarr' }],
      unchecked: [],
      someUnchecked: false,
    });
    expect(renamed()).toBe(0);

    const confirmed = await rename({ kind: 'file', path: 'Pack/readme.txt', name: 'notes.txt', confirm: true });
    expect(confirmed.status).toBe(200);
    expect(mocks.qbit.renameFile).toHaveBeenCalledTimes(1);
  });

  it('does not ask for a category no arr uses, or for a parent of one', async () => {
    mocks.qbit.getTorrents.mockResolvedValue([{ hash: HASH, name: 'Pack', category: 'tv' }]);
    mocks.sonarr = [sonarrUsing('tv/anime')];
    expect((await rename({ kind: 'file', path: 'Pack/readme.txt', name: 'notes.txt' })).status).toBe(200);
  });

  it('names the instances to an admin only', async () => {
    mocks.qbit.getTorrents.mockResolvedValue([{ hash: HASH, name: 'Pack', category: 'tv' }]);
    mocks.sonarr = [
      sonarrUsing('tv'),
      { connection: { label: 'Sonarr 4K' }, client: { getDownloadClients: vi.fn(async () => { throw new Error('down'); }) } },
    ];
    const member = await rename({ kind: 'file', path: 'Pack/readme.txt', name: 'notes.txt' });
    expect(await member.json()).toMatchObject({ uses: [{ app: 'Sonarr', instance: 'Sonarr' }], unchecked: [], someUnchecked: true });

    mocks.requireUserCapability.mockResolvedValue({ ok: true, user: { ...USER, role: 'admin' }, session: {} });
    const admin = await rename({ kind: 'file', path: 'Pack/readme.txt', name: 'notes.txt' });
    expect(await admin.json()).toMatchObject({
      uses: [{ app: 'Sonarr', instance: 'Sonarr Anime' }],
      unchecked: ['Sonarr 4K'],
      someUnchecked: true,
    });
  });

  it('asks when an arr does not answer', async () => {
    mocks.qbit.getTorrents.mockResolvedValue([{ hash: HASH, name: 'Pack', category: 'tv' }]);
    mocks.sonarr = [{ connection: { label: 'Sonarr' }, client: { getDownloadClients: vi.fn(async () => { throw new Error('down'); }) } }];
    const res = await rename({ kind: 'file', path: 'Pack/readme.txt', name: 'notes.txt' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ needsConfirm: true, uses: [], someUnchecked: true });
  });

  it('asks no arr about a torrent with no category', async () => {
    const getDownloadClients = vi.fn();
    mocks.sonarr = [{ connection: { label: 'Sonarr' }, client: { getDownloadClients } }];
    expect((await rename({ kind: 'file', path: 'Pack/readme.txt', name: 'notes.txt' })).status).toBe(200);
    expect(getDownloadClients).not.toHaveBeenCalled();
  });
});
