import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUserCapability: vi.fn(),
  bump: vi.fn(),
  log: vi.fn(),
  qbit: {
    getTags: vi.fn(),
    getTorrents: vi.fn(),
    createTags: vi.fn(),
    deleteTags: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.requireUserCapability }));
vi.mock('@/lib/service-helpers', () => ({ getQBittorrentClient: vi.fn().mockResolvedValue(mocks.qbit) }));
vi.mock('@/lib/cache/qbittorrent-version', () => ({ bumpQbitCacheVersion: mocks.bump }));
vi.mock('@/lib/logger', () => ({ logger: { info: mocks.log, warn: mocks.log, error: mocks.log } }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));

import { DELETE, GET, POST } from '@/app/api/qbittorrent/tags/route';

const USER = { id: 'u1', username: 'member', role: 'user' };
const FORBIDDEN = { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };

const request = (method: string, body: unknown) =>
  new NextRequest('http://localhost/api/qbittorrent/tags', {
    method,
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const create = (body: unknown) => POST(request('POST', body));
const remove = (body: unknown) => DELETE(request('DELETE', body));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUserCapability.mockResolvedValue({ ok: true, user: USER, session: {} });
  mocks.qbit.getTags.mockResolvedValue(['keep', 'seed', 'unused']);
  mocks.qbit.getTorrents.mockResolvedValue([
    { hash: 'a', name: 'A', tags: 'keep, seed', tracker: 'https://t.example/announce?passkey=secret', magnet_uri: 'magnet:?tr=secret' },
    { hash: 'b', name: 'B', tags: 'seed' },
    { hash: 'c', name: 'C', tags: '' },
  ]);
  mocks.qbit.createTags.mockResolvedValue(undefined);
  mocks.qbit.deleteTags.mockResolvedValue(undefined);
});

describe('who may see and change tags', () => {
  it('lists for torrents.view and changes for torrents.manage', async () => {
    await GET(new NextRequest('http://localhost/api/qbittorrent/tags'));
    expect(mocks.requireUserCapability).toHaveBeenLastCalledWith('torrents.view');
    await create({ name: 'new' });
    expect(mocks.requireUserCapability).toHaveBeenLastCalledWith('torrents.manage');
    await remove({ tags: ['unused'] });
    expect(mocks.requireUserCapability).toHaveBeenLastCalledWith('torrents.manage');
  });

  it.each([
    ['GET', () => GET(new NextRequest('http://localhost/api/qbittorrent/tags'))],
    ['POST', () => create({ name: 'new' })],
    ['DELETE', () => remove({ tags: ['seed'] })],
  ])('%s is refused without the capability and never reaches qBittorrent', async (_method, call) => {
    mocks.requireUserCapability.mockResolvedValue(FORBIDDEN);
    const res = await call();
    expect(res.status).toBe(403);
    expect(mocks.qbit.getTags).not.toHaveBeenCalled();
    expect(mocks.qbit.createTags).not.toHaveBeenCalled();
    expect(mocks.qbit.deleteTags).not.toHaveBeenCalled();
  });
});

describe('GET', () => {
  it('lists every tag with its torrent count and nothing else about the torrents', async () => {
    const res = await GET(new NextRequest('http://localhost/api/qbittorrent/tags'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      tags: [
        { name: 'keep', torrents: 1 },
        { name: 'seed', torrents: 2 },
        { name: 'unused', torrents: 0 },
      ],
    });
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});

describe('POST', () => {
  it('creates a trimmed tag and bumps the cache version', async () => {
    const res = await create({ name: '  fresh  ' });
    expect(res.status).toBe(200);
    expect(mocks.qbit.createTags).toHaveBeenCalledWith(['fresh']);
    expect(mocks.bump).toHaveBeenCalledOnce();
  });

  it.each([
    ['a comma', { name: 'a,b' }],
    ['an empty name', { name: '   ' }],
    ['a name over 100 characters', { name: 'x'.repeat(101) }],
    ['a control character', { name: 'a\nb' }],
    ['a non-string', { name: ['a'] }],
    ['no name', {}],
  ])('refuses %s', async (_label, body) => {
    const res = await create(body);
    expect(res.status).toBe(400);
    expect(mocks.qbit.createTags).not.toHaveBeenCalled();
  });

  it('refuses malformed JSON', async () => {
    const res = await create('{nope');
    expect(res.status).toBe(400);
  });

  it('refuses a tag that exists', async () => {
    const res = await create({ name: 'seed' });
    expect(res.status).toBe(409);
    expect(mocks.qbit.createTags).not.toHaveBeenCalled();
    expect(mocks.bump).not.toHaveBeenCalled();
  });
});

describe('DELETE', () => {
  it('deletes the tag everywhere, bumps the cache and logs who did it and how many torrents had it', async () => {
    const res = await remove({ tags: ['seed'] });
    expect(res.status).toBe(200);
    expect(mocks.qbit.deleteTags).toHaveBeenCalledWith(['seed']);
    expect(mocks.bump).toHaveBeenCalledOnce();
    expect(mocks.log).toHaveBeenCalledWith(
      'qBittorrent tags deleted',
      expect.objectContaining({ userId: 'u1', tags: ['seed'], torrents: { seed: 2 } }),
      expect.anything(),
    );
  });

  it.each([
    ['no list', {}],
    ['an empty list', { tags: [] }],
    ['a comma, which would delete two tags', { tags: ['keep,seed'] }],
    ['a non-string', { tags: [1] }],
    ['more than 50', { tags: Array.from({ length: 51 }, (_, i) => `t${i}`) }],
  ])('refuses %s', async (_label, body) => {
    const res = await remove(body);
    expect(res.status).toBe(400);
    expect(mocks.qbit.deleteTags).not.toHaveBeenCalled();
  });

  it('refuses a tag qBittorrent does not have', async () => {
    const res = await remove({ tags: ['seed', 'gone'] });
    expect(res.status).toBe(404);
    expect(mocks.qbit.deleteTags).not.toHaveBeenCalled();
  });

  it('answers 500 without upstream detail when qBittorrent fails', async () => {
    mocks.qbit.deleteTags.mockRejectedValue(new Error('upstream boom at http://10.0.0.1'));
    const res = await remove({ tags: ['seed'] });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('10.0.0.1');
    expect(mocks.bump).not.toHaveBeenCalled();
  });
});
