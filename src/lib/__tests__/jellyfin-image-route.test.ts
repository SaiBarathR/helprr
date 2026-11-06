import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireUserCapability: vi.fn(),
  can: vi.fn(),
  findFirst: vi.fn(),
  getItems: vi.fn(),
  redisGet: vi.fn(),
  redisSet: vi.fn(),
  fetchImageWithServerCache: vi.fn(),
  getConnectionHeaders: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireUserCapability: mocks.requireUserCapability,
}));
vi.mock('@/lib/permissions', () => ({ can: mocks.can }));
vi.mock('@/lib/db', () => ({
  prisma: { serviceConnection: { findFirst: mocks.findFirst } },
}));
vi.mock('@/lib/service-helpers', () => ({
  getJellyfinUserContext: vi.fn(async () => ({
    client: { getItems: mocks.getItems },
    connectionFingerprint: 'connection-fingerprint',
    jellyfinUserId: 'jellyfin-user-1',
  })),
}));
vi.mock('@/lib/redis', () => ({
  getRedisClient: vi.fn(async () => ({
    get: mocks.redisGet,
    set: mocks.redisSet,
  })),
}));
vi.mock('@/lib/cache/image-cache', () => ({
  fetchImageWithServerCache: mocks.fetchImageWithServerCache,
}));
vi.mock('@/lib/service-connection-secrets', () => ({
  getConnectionHeaders: mocks.getConnectionHeaders,
}));
vi.mock('@/lib/api-logger', () => ({
  withApiLogging: (handler: unknown) => handler,
}));

import { GET } from '@/app/api/jellyfin/image/route';

const user = {
  id: 'user-1',
  role: 'member',
};

function request(headers?: HeadersInit): NextRequest {
  return new NextRequest(
    'http://helprr.local/api/jellyfin/image?itemId=abc123&type=Primary&maxWidth=400',
    { headers },
  );
}

// sha1 of the mocked [1, 2, 3] image bytes.
const BODY_ETAG = '"7037807198c22a7d2b0807371d763779a84fdfcf"';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUserCapability.mockResolvedValue({
    ok: true,
    user,
    session: {},
  });
  mocks.can.mockReturnValue(false);
  mocks.redisGet.mockResolvedValue(null);
  mocks.redisSet.mockResolvedValue('OK');
  mocks.findFirst.mockResolvedValue({
    url: 'http://jellyfin.internal:8096',
    apiKey: 'secret-key',
  });
  mocks.getConnectionHeaders.mockReturnValue({ 'X-Proxy-Auth': 'proxy-secret' });
  mocks.fetchImageWithServerCache.mockResolvedValue({
    status: 200,
    body: Buffer.from([1, 2, 3]),
    contentType: 'image/jpeg',
    cacheStatus: 'MISS',
  });
});

describe('dedicated Jellyfin image authorization', () => {
  it('rejects callers without jellyfin.view before any item or connection work', async () => {
    mocks.requireUserCapability.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });

    const response = await GET(request());

    expect(response.status).toBe(403);
    expect(mocks.getItems).not.toHaveBeenCalled();
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.fetchImageWithServerCache).not.toHaveBeenCalled();
  });

  it('returns 404 when an ordinary member cannot access the Jellyfin item', async () => {
    mocks.getItems.mockResolvedValue({ Items: [] });

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(mocks.getItems).toHaveBeenCalledWith({ ids: 'abc123', limit: 1 });
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.fetchImageWithServerCache).not.toHaveBeenCalled();
  });

  it('serves authorized artwork with the acting user and configured credentials', async () => {
    mocks.getItems.mockResolvedValue({ Items: [{ Id: 'abc123' }] });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toBe('private, no-cache');
    expect(response.headers.get('vary')).toBe('Cookie');
    expect(response.headers.get('x-helprr-cache')).toBe('MISS');
    expect(response.headers.get('etag')).toBe(BODY_ETAG);
    expect(mocks.fetchImageWithServerCache).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheKey: 'jellyfin:abc123:Primary:400:80:webp',
        upstreamUrl:
          'http://jellyfin.internal:8096/Items/abc123/Images/Primary?maxWidth=400&quality=80&format=Webp',
        requesterId: 'user-1',
        // Jellyfin names unresized art by its file extension.
        ignoreDeclaredType: true,
        upstreamHeaders: {
          'X-Proxy-Auth': 'proxy-secret',
          Authorization: 'MediaBrowser Token="secret-key"',
        },
      }),
    );
    const options = mocks.fetchImageWithServerCache.mock.calls[0]?.[0] as {
      isRedirectTargetAllowed: (target: URL) => boolean;
    };
    expect(options.isRedirectTargetAllowed(
      new URL('http://jellyfin.internal:8096/redirected'),
    )).toBe(true);
    expect(options.isRedirectTargetAllowed(
      new URL('http://items/credential-leak'),
    )).toBe(false);
  });
});

describe('Jellyfin image revalidation', () => {
  it('answers a matching If-None-Match with an empty 304 that keeps the cache headers', async () => {
    mocks.getItems.mockResolvedValue({ Items: [{ Id: 'abc123' }] });

    for (const ifNoneMatch of [BODY_ETAG, `"other", W/${BODY_ETAG}`]) {
      const response = await GET(request({ 'If-None-Match': ifNoneMatch }));

      expect(response.status).toBe(304);
      expect(await response.arrayBuffer()).toHaveProperty('byteLength', 0);
      expect(response.headers.get('etag')).toBe(BODY_ETAG);
      expect(response.headers.get('cache-control')).toBe('private, no-cache');
      expect(response.headers.get('vary')).toBe('Cookie');
    }
  });

  it('sends the full image when the bytes changed', async () => {
    mocks.getItems.mockResolvedValue({ Items: [{ Id: 'abc123' }] });

    const response = await GET(request({ 'If-None-Match': '"stale-etag"' }));

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]));
  });

  it('never answers 304 to a caller who lost jellyfin.view', async () => {
    mocks.requireUserCapability.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const response = await GET(request({ 'If-None-Match': BODY_ETAG }));

    expect(response.status).toBe(401);
    expect(mocks.fetchImageWithServerCache).not.toHaveBeenCalled();
  });

  it('never answers 304 to a member who cannot access the item', async () => {
    mocks.getItems.mockResolvedValue({ Items: [] });

    const response = await GET(request({ 'If-None-Match': BODY_ETAG }));

    expect(response.status).toBe(404);
    expect(response.headers.get('etag')).toBeNull();
    expect(mocks.fetchImageWithServerCache).not.toHaveBeenCalled();
  });

  it('lets the browser reuse a missing/invalid image answer for ten minutes only', async () => {
    mocks.can.mockReturnValue(true);
    for (const status of [404, 413, 415]) {
      mocks.fetchImageWithServerCache.mockResolvedValueOnce({
        status, body: null, contentType: null, cacheStatus: 'HIT',
      });
      const response = await GET(request());
      expect(response.status).toBe(status);
      expect(response.headers.get('cache-control')).toBe('private, max-age=600');
    }

    mocks.fetchImageWithServerCache.mockResolvedValueOnce({
      status: 502, body: null, contentType: null, cacheStatus: 'MISS',
    });
    const outage = await GET(request());
    expect(outage.status).toBe(502);
    expect(outage.headers.get('cache-control') ?? '').not.toContain('max-age');
  });
});
