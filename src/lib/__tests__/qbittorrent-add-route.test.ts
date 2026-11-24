import { createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireUserCapability: vi.fn(),
  qbit: {
    getTorrents: vi.fn(),
    addMagnet: vi.fn(),
    addTorrentFile: vi.fn(),
    getDefaultSavePath: vi.fn(),
    getCategories: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  requireUser: mocks.requireUser,
  requireUserCapability: mocks.requireUserCapability,
}));
vi.mock('@/lib/service-helpers', () => ({ getQBittorrentClient: vi.fn().mockResolvedValue(mocks.qbit) }));
vi.mock('@/lib/file-audit', () => ({ deleteTorrentsAudited: vi.fn(), TORRENT_DELETE_REFUSALS: {} }));
vi.mock('@/lib/cache/qbittorrent-version', () => ({ bumpQbitCacheVersion: vi.fn() }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));

import { POST } from '@/app/api/qbittorrent/route';

const MAGNET_HASH = '0123456789abcdef0123456789abcdef01234567';
const MAGNET = `magnet:?xt=urn:btih:${MAGNET_HASH}&dn=Test`;
const INFO = 'd4:name4:Test12:piece lengthi16384ee';
const TORRENT = `d8:announce4:http4:info${INFO}e`;
const FILE_HASH = createHash('sha1').update(INFO).digest('hex');

// Holds every add option and the "torrents.bandwidth" grant.
const ADMIN = { id: 'u1', role: 'admin', template: 'admin', permissions: {} };
// May add torrents, but not change bandwidth limits.
const MEMBER = { id: 'u2', role: 'member', template: 'member', permissions: { 'torrents.add': true, 'torrents.bandwidth': false } };

const ALL_OPTIONS = {
  tags: [' 4k ', 'movies', '4k'],
  rename: ' My Film ',
  sequentialDownload: true,
  firstLastPiecePrio: true,
  autoTMM: false,
  contentLayout: 'NoSubfolder',
  skipChecking: true,
  addToTopOfQueue: true,
  dlLimit: 1048576,
  upLimit: 102400,
};
const FORWARDED = {
  tags: ['4k', 'movies'],
  rename: 'My Film',
  sequentialDownload: true,
  firstLastPiecePrio: true,
  autoTMM: false,
  contentLayout: 'NoSubfolder',
  skipChecking: true,
  addToTopOfQueue: true,
  dlLimit: 1048576,
  upLimit: 102400,
};

function magnet(body: Record<string, unknown>) {
  return POST(new NextRequest('http://localhost/api/qbittorrent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ urls: MAGNET, ...body }),
  }));
}

/** A form as the add page builds it: tags one field each, everything else as text. */
function file(fields: Record<string, unknown>) {
  const form = new FormData();
  form.append('file', new File([TORRENT], 'test.torrent', { type: 'application/x-bittorrent' }));
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) for (const item of value) form.append(key, String(item));
    else if (value !== undefined) form.append(key, String(value));
  }
  return POST(new NextRequest('http://localhost/api/qbittorrent', { method: 'POST', body: form }));
}

const paths = {
  magnet: { post: magnet, add: () => mocks.qbit.addMagnet, optionsArg: 1 },
  file: { post: file, add: () => mocks.qbit.addTorrentFile, optionsArg: 2 },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ ok: true, user: ADMIN, session: {} });
  mocks.qbit.getDefaultSavePath.mockResolvedValue('/downloads');
  mocks.qbit.getCategories.mockResolvedValue({ movies: { name: 'movies', savePath: '/media/movies' } });
  mocks.qbit.addMagnet.mockResolvedValue('Ok.');
  // The duplicate check finds nothing; the confirmation after the add finds it.
  mocks.qbit.getTorrents.mockReset().mockResolvedValueOnce([]).mockResolvedValue([{ hash: 'x' }]);
});

describe.each(['magnet', 'file'] as const)('adding a %s', (path) => {
  const { post, add, optionsArg } = paths[path];
  const sentOptions = () => add().mock.calls[0][optionsArg];

  it('forwards every option, trimmed and deduplicated', async () => {
    const res = await post(ALL_OPTIONS);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, hash: path === 'magnet' ? MAGNET_HASH : FILE_HASH });
    expect(sentOptions()).toMatchObject(FORWARDED);
  });

  it('forwards nothing extra when no option is set', async () => {
    const res = await post({});
    expect(res.status).toBe(200);
    for (const key of Object.keys(FORWARDED)) expect(sentOptions()).not.toHaveProperty(key);
  });

  it('forwards only the allowed fields', async () => {
    const res = await post({ cookie: 'session=x', downloadPath: '/etc', ratioLimit: 5, stopped: 'true' });
    expect(res.status).toBe(200);
    expect(sentOptions()).not.toHaveProperty('cookie');
    expect(sentOptions()).not.toHaveProperty('downloadPath');
    expect(sentOptions()).not.toHaveProperty('ratioLimit');
  });

  it('treats a 0 speed limit and a blank name as not set', async () => {
    const res = await post({ dlLimit: 0, upLimit: 0, rename: '   ' });
    expect(res.status).toBe(200);
    expect(sentOptions()).not.toHaveProperty('dlLimit');
    expect(sentOptions()).not.toHaveProperty('upLimit');
    expect(sentOptions()).not.toHaveProperty('rename');
  });

  it.each([
    ['a boolean that is not true or false', { sequentialDownload: 'yes' }, 'sequentialDownload must be true or false'],
    ['a numeric boolean', { skipChecking: 1 }, 'skipChecking must be true or false'],
    ['an unknown content layout', { contentLayout: 'Flat' }, 'contentLayout must be Original, Subfolder or NoSubfolder'],
    ['a negative speed limit', { dlLimit: -1 }, 'Speed limits are whole bytes per second, from 0 (unlimited) to 2147483647'],
    ['a fractional speed limit', { upLimit: 1.5 }, 'Speed limits are whole bytes per second, from 0 (unlimited) to 2147483647'],
    ['a speed limit past 32 bits', { dlLimit: 2_147_483_648 }, 'Speed limits are whole bytes per second, from 0 (unlimited) to 2147483647'],
    ['a speed limit in words', { upLimit: 'fast' }, 'Speed limits are whole bytes per second, from 0 (unlimited) to 2147483647'],
    ['a name with a slash', { rename: 'a/b' }, 'The name needs at most 255 characters and no slash'],
    ['a name with a backslash', { rename: 'a\\b' }, 'The name needs at most 255 characters and no slash'],
    ['a name with a control character', { rename: 'a\u0000b' }, 'The name needs at most 255 characters and no slash'],
    ['a name that is too long', { rename: 'a'.repeat(256) }, 'The name needs at most 255 characters and no slash'],
    ['a tag with a comma', { tags: ['a,b'] }, 'Each tag needs 1 to 100 characters and no comma'],
    ['a blank tag', { tags: ['  '] }, 'Each tag needs 1 to 100 characters and no comma'],
    ['automatic management with a save path', { autoTMM: true, savepath: '/downloads/x' }, 'Automatic management picks the folder: leave the save path empty'],
  ])('refuses %s before adding anything', async (_label, body, error) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(add()).not.toHaveBeenCalled();
  });

  it('accepts automatic management without a save path', async () => {
    const res = await post({ autoTMM: true, category: 'movies' });
    expect(res.status).toBe(200);
    expect(sentOptions()).toMatchObject({ autoTMM: true, category: 'movies' });
  });

  it.each([
    // qBittorrent 5.1.4 creates it and, under automatic management, saves to "/escape".
    ['a parent hop under automatic management', { autoTMM: true, category: '../escape' }],
    ['a parent hop under qBittorrent\'s default management', { category: '../../config' }],
    ['a category qBittorrent does not have', { autoTMM: true, category: 'brand-new' }],
  ])('refuses %s before adding anything', async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "category must be one of qBittorrent's categories" });
    expect(add()).not.toHaveBeenCalled();
  });

  it('refuses more than 50 tags', async () => {
    const res = await post({ tags: Array.from({ length: 51 }, (_, i) => `t${i}`) });
    expect(res.status).toBe(400);
    expect(add()).not.toHaveBeenCalled();
  });

  it('refuses an upload limit alone from a user without the bandwidth grant', async () => {
    mocks.requireUser.mockResolvedValue({ ok: true, user: MEMBER, session: {} });
    const res = await post({ upLimit: 1024 });
    expect(res.status).toBe(403);
    expect(add()).not.toHaveBeenCalled();
  });

  it('refuses speed limits from a user without the bandwidth grant', async () => {
    mocks.requireUser.mockResolvedValue({ ok: true, user: MEMBER, session: {} });
    const res = await post({ dlLimit: 1024 });
    expect(res.status).toBe(403);
    expect(add()).not.toHaveBeenCalled();
  });

  it('lets that user add with every other option', async () => {
    mocks.requireUser.mockResolvedValue({ ok: true, user: MEMBER, session: {} });
    const res = await post({ ...ALL_OPTIONS, dlLimit: undefined, upLimit: undefined });
    expect(res.status).toBe(200);
    expect(sentOptions()).toMatchObject({ tags: ['4k', 'movies'], rename: 'My Film', skipChecking: true });
  });

  it('still checks the save path against the download folders', async () => {
    const res = await post({ savepath: '/etc', sequentialDownload: true });
    expect(res.status).toBe(400);
    expect(add()).not.toHaveBeenCalled();
  });
});

describe('form fields on the .torrent path', () => {
  it('reads booleans and limits sent as text', async () => {
    const res = await file({ sequentialDownload: 'false', dlLimit: '2048' });
    expect(res.status).toBe(200);
    expect(mocks.qbit.addTorrentFile.mock.calls[0][2]).toMatchObject({ sequentialDownload: false, dlLimit: 2048 });
  });

  it('refuses a limit with anything but digits', async () => {
    const res = await file({ upLimit: '1e3' });
    expect(res.status).toBe(400);
  });
});
