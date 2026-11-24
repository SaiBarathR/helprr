import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  requireUserCapability: vi.fn(),
  resolveSharedInput: vi.fn(),
  readSharedTorrents: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { to });
  }),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/auth', () => ({ getCurrentUser: mocks.getCurrentUser, requireUserCapability: mocks.requireUserCapability }));
vi.mock('@/lib/share/resolve-shared-input', () => ({ resolveSharedInput: mocks.resolveSharedInput }));
vi.mock('@/components/share/share-resolution-view', () => ({ ShareResolutionView: () => null }));
vi.mock('@/lib/share/shared-torrents', () => ({ readSharedTorrents: mocks.readSharedTorrents }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));

import SharePage from '@/app/share/page';
import { GET } from '@/app/api/share/torrents/route';
import { sharedTorrentLinks } from '@/lib/share/torrent-links';
import { NextResponse } from 'next/server';

const MAGNET = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=A';
const ADDER = { id: 'u1', role: 'member', template: 'member', permissions: { 'torrents.add': true } };
const VIEWER = { id: 'u2', role: 'member', template: 'member', permissions: { 'torrents.add': false } };

function share(params: Record<string, string>) {
  return SharePage({ searchParams: Promise.resolve(params) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveSharedInput.mockResolvedValue({ kind: 'unknown' });
});

describe('sharedTorrentLinks', () => {
  it('finds magnets and .torrent links in the text and url', () => {
    expect(sharedTorrentLinks({
      text: `Look at this ${MAGNET}\nand https://example.org/files/b.TORRENT?passkey=1 and https://example.org/page`,
      url: 'https://example.org/c.torrent',
    })).toEqual(['https://example.org/c.torrent', MAGNET, 'https://example.org/files/b.TORRENT?passkey=1']);
  });

  it.each([
    ['a page link', { url: 'https://www.themoviedb.org/movie/1' }],
    ['plain text', { text: 'Dune Part Two' }],
    ['a .torrent name with no link', { text: 'b.torrent' }],
    ['a file: link', { url: 'file:///sdcard/a.torrent' }],
  ])('finds nothing in %s', (_label, input) => {
    expect(sharedTorrentLinks(input)).toEqual([]);
  });
});

describe('the /share page', () => {
  it('opens Torrents -> Add with the shared links for a user who may add torrents', async () => {
    mocks.getCurrentUser.mockResolvedValue(ADDER);
    const error = await share({ text: `${MAGNET} https://example.org/b.torrent` }).catch((e) => e);
    expect(error.to).toBe(`/torrents/add?links=${encodeURIComponent(`${MAGNET}\nhttps://example.org/b.torrent`)}`);
    expect(mocks.resolveSharedInput).not.toHaveBeenCalled();
  });

  it('resolves a magnet as it always did for a user who may not add torrents', async () => {
    mocks.getCurrentUser.mockResolvedValue(VIEWER);
    await share({ text: MAGNET });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.resolveSharedInput).toHaveBeenCalled();
  });

  it('resolves a title link as a title', async () => {
    mocks.getCurrentUser.mockResolvedValue(ADDER);
    await share({ url: 'https://www.themoviedb.org/movie/1' });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe('GET /api/share/torrents', () => {
  it('needs torrents.add', async () => {
    mocks.requireUserCapability.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });
    const res = await GET();
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('torrents.add');
    expect(res.status).toBe(403);
    expect(mocks.readSharedTorrents).not.toHaveBeenCalled();
  });

  it("gives back the user's own shared files", async () => {
    mocks.requireUserCapability.mockResolvedValue({ ok: true, user: ADDER, session: {} });
    mocks.readSharedTorrents.mockResolvedValue([{ name: 'a.torrent', data: 'ZA==' }]);
    const res = await GET();
    expect(mocks.readSharedTorrents).toHaveBeenCalledWith('u1');
    expect(await res.json()).toEqual({ files: [{ name: 'a.torrent', data: 'ZA==' }] });
  });

  it('says when they have expired', async () => {
    mocks.requireUserCapability.mockResolvedValue({ ok: true, user: ADDER, session: {} });
    mocks.readSharedTorrents.mockResolvedValue(null);
    expect((await GET()).status).toBe(404);
  });
});
