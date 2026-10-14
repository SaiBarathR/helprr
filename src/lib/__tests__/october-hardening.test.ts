import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  qbit: {
    pauseTorrent: vi.fn(),
    deleteTorrent: vi.fn(),
  },
  sonarr: { getSeriesById: vi.fn(), updateSeries: vi.fn() },
  radarr: { getMovieById: vi.fn(), updateMovie: vi.fn() },
  lidarr: { getArtistById: vi.fn(), updateArtist: vi.fn(), updateAlbum: vi.fn() },
  prowlarr: { testIndexer: vi.fn() },
  watchlistUpsert: vi.fn(),
}));

const admin = { id: 'admin-1', role: 'admin', template: 'admin', permissions: {} };

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => null),
  requireUserCapability: vi.fn(async () => ({ ok: true, user: admin, session: {} })),
}));
vi.mock('@/lib/api-logger', () => ({
  withApiLogging: (handler: unknown) => handler,
}));
vi.mock('@/lib/service-helpers', () => ({
  getQBittorrentClient: vi.fn(async () => mocks.qbit),
  getSonarrClient: vi.fn(async () => mocks.sonarr),
  getRadarrClient: vi.fn(async () => mocks.radarr),
  getLidarrClient: vi.fn(async () => mocks.lidarr),
  getProwlarrClient: vi.fn(async () => mocks.prowlarr),
}));
vi.mock('@/lib/file-audit', () => ({
  runWithOperationAudit: vi.fn(async (_input: unknown, operation: () => Promise<unknown>) => operation()),
  snapshotTorrentDeleteTargets: vi.fn(async () => ({ targetTitle: 'T', itemCount: 1, details: {} })),
}));
vi.mock('@/lib/cache/qbittorrent-version', () => ({ bumpQbitCacheVersion: vi.fn() }));
vi.mock('@/lib/cache/tagged-library', () => ({ invalidateTaggedLibrary: vi.fn() }));
vi.mock('@/lib/db', () => ({
  prisma: {
    watchlistItem: {
      upsert: mocks.watchlistUpsert,
      findUnique: vi.fn(async () => null),
    },
    watchlistTag: { findMany: vi.fn(async () => []) },
  },
}));

import { POST as torrentHashAction } from '@/app/api/qbittorrent/[hash]/route';
import { GET as sonarrGet, PUT as sonarrPut } from '@/app/api/sonarr/[id]/route';
import { PUT as radarrPut } from '@/app/api/radarr/[id]/route';
import { PUT as lidarrPut } from '@/app/api/lidarr/[id]/route';
import { PUT as albumPut } from '@/app/api/lidarr/album/[albumId]/route';
import { POST as prowlarrTest } from '@/app/api/prowlarr/indexers/[id]/test/route';
import { POST as watchlistPost } from '@/app/api/watchlist/route';
import { isAllowedMediaPath } from '@/lib/jellyfin-playback/media-path';
import { isValidExternalId, watchlistHrefFor } from '@/lib/watchlist-helpers';

function json(path: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const params = <T extends object>(value: T) => ({ params: Promise.resolve(value) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sonarr.updateSeries.mockImplementation(async (body: unknown) => body);
  mocks.sonarr.getSeriesById.mockResolvedValue({ id: 7 });
  mocks.radarr.updateMovie.mockImplementation(async (body: unknown) => body);
  mocks.lidarr.updateArtist.mockImplementation(async (body: unknown) => body);
  mocks.lidarr.updateAlbum.mockImplementation(async (body: unknown) => body);
  mocks.prowlarr.testIndexer.mockResolvedValue(null);
  mocks.watchlistUpsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => ({
    id: 'w1', tags: [], ...create, addedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
  }));
});

describe('single-torrent actions', () => {
  it.each(['all', 'aaaa|bbbb', 'not-a-hash', '0123456789abcdef'])('reject %j before any qBittorrent call', async (hash) => {
    const res = await torrentHashAction(json(`/api/qbittorrent/${hash}`, 'POST', { action: 'delete' }), params({ hash }));
    expect(res.status).toBe(400);
    expect(mocks.qbit.deleteTorrent).not.toHaveBeenCalled();
  });

  it.each([
    '0123456789abcdef0123456789abcdef01234567',
    '0123456789ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef',
  ])('still act on a single v1 or v2 hash %s', async (hash) => {
    const res = await torrentHashAction(json(`/api/qbittorrent/${hash}`, 'POST', { action: 'pause' }), params({ hash }));
    expect(res.status).toBe(200);
    expect(mocks.qbit.pauseTorrent).toHaveBeenCalledWith(hash);
  });
});

describe('Jellyfin fallback font paths', () => {
  it('reject a name that only starts with "fonts"', () => {
    expect(isAllowedMediaPath('/fallbackfont/fontsSuffix')).toBe(false);
    expect(isAllowedMediaPath('/fallbackfont/fonts-extra/x.woff2')).toBe(false);
  });

  it('keep the font list and font files', () => {
    expect(isAllowedMediaPath('/fallbackfont/fonts')).toBe(true);
    expect(isAllowedMediaPath('/FallbackFont/Fonts/')).toBe(true);
    expect(isAllowedMediaPath('/FallbackFont/Fonts/Noto Sans CJK.ttf')).toBe(true);
  });
});

describe('arr PUT updates forward the validated path id', () => {
  const routes = [
    { name: 'Sonarr series', put: sonarrPut, path: '/api/sonarr/7', p: { id: '7' }, update: mocks.sonarr.updateSeries },
    { name: 'Radarr movie', put: radarrPut, path: '/api/radarr/7', p: { id: '7' }, update: mocks.radarr.updateMovie },
    { name: 'Lidarr artist', put: lidarrPut, path: '/api/lidarr/7', p: { id: '7' }, update: mocks.lidarr.updateArtist },
    { name: 'Lidarr album', put: albumPut, path: '/api/lidarr/album/7', p: { albumId: '7' }, update: mocks.lidarr.updateAlbum },
  ];

  it.each(routes)('$name: a string or absent body id is sent as the number 7', async ({ put, path, p, update }) => {
    for (const body of [{ id: '7', title: 'x' }, { id: '7.0', title: 'x' }, { title: 'x' }]) {
      update.mockClear();
      const res = await put(json(path, 'PUT', body), params(p) as never);
      expect(res.status).toBe(200);
      expect(update.mock.calls[0][0]).toMatchObject({ id: 7, title: 'x' });
    }
  });

  it.each(routes)('$name: a different body id is still rejected', async ({ put, path, p, update }) => {
    const res = await put(json(path, 'PUT', { id: 8 }), params(p) as never);
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('Sonarr series GET id', () => {
  it.each(['abc', '0', '-2', '1.5', 'Infinity'])('rejects %j before calling Sonarr', async (id) => {
    const res = await sonarrGet(json(`/api/sonarr/${id}`, 'GET'), params({ id }));
    expect(res.status).toBe(400);
    expect(mocks.sonarr.getSeriesById).not.toHaveBeenCalled();
  });

  it('still fetches a valid id', async () => {
    const res = await sonarrGet(json('/api/sonarr/7', 'GET'), params({ id: '7' }));
    expect(res.status).toBe(200);
    expect(mocks.sonarr.getSeriesById).toHaveBeenCalledWith(7);
  });
});

describe('Prowlarr indexer test id', () => {
  it.each(['12abc', 'abc', '-1', '1.5'])('rejects %j before calling Prowlarr', async (id) => {
    const res = await prowlarrTest(json(`/api/prowlarr/indexers/${id}/test`, 'POST'), params({ id }));
    expect(res.status).toBe(400);
    expect(mocks.prowlarr.testIndexer).not.toHaveBeenCalled();
  });

  it('still tests a numeric indexer', async () => {
    const res = await prowlarrTest(json('/api/prowlarr/indexers/12/test', 'POST'), params({ id: '12' }));
    expect(res.status).toBe(200);
    expect(mocks.prowlarr.testIndexer).toHaveBeenCalledWith(12);
  });
});

describe('watchlist external ids', () => {
  it('accept the positive integer ids every source uses', () => {
    expect(['1', '603', 603, '21459'].every((id) => isValidExternalId(String(id)))).toBe(true);
  });

  it.each(['0', '01', '-5', '12abc', '../discover', '1/2', ' 12', '1e3', ''])('reject %j', (id) => {
    expect(isValidExternalId(id)).toBe(false);
  });

  it('builds no link from a stored id that is not a plain number', () => {
    expect(watchlistHrefFor('TMDB', '603', 'movie')).toBe('/discover/movie/603');
    expect(watchlistHrefFor('TMDB', '603/../../settings', 'movie')).toBeNull();
    expect(watchlistHrefFor('ANILIST', 'x?y', 'anime')).toBeNull();
  });

  it('refuses a malformed id on write and accepts a numeric one', async () => {
    const bad = await watchlistPost(json('/api/watchlist', 'POST', {
      source: 'TMDB', externalId: '603/../x', mediaType: 'movie', title: 'The Matrix',
    }));
    expect(bad.status).toBe(400);
    expect(mocks.watchlistUpsert).not.toHaveBeenCalled();

    const good = await watchlistPost(json('/api/watchlist', 'POST', {
      source: 'TMDB', externalId: 603, mediaType: 'movie', title: 'The Matrix',
    }));
    expect([200, 201]).toContain(good.status);
  });
});
