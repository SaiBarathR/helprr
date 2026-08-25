import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeterministicImageUpstream } from '@/lib/__tests__/helpers/image-upstream-server';

vi.mock('@/lib/cache/state', () => ({
  getCacheImagesEnabled: vi.fn().mockResolvedValue(false),
}));
vi.mock('@/lib/redis', () => ({
  getRedisClient: vi.fn().mockRejectedValue(new Error('disabled for upstream harness')),
}));

const servers: Array<Awaited<ReturnType<typeof createDeterministicImageUpstream>>> = [];

beforeEach(() => {
  process.env.IMAGE_UPSTREAM_MAX_BYTES = '1024';
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  delete process.env.IMAGE_UPSTREAM_MAX_BYTES;
  vi.resetModules();
});

async function imageCache() {
  vi.resetModules();
  return import('@/lib/cache/image-cache');
}

describe('deterministic image upstream harness', () => {
  it.each(['jpeg', 'png', 'webp'] as const)('serves a configurable valid %s body', async (format) => {
    const upstream = await createDeterministicImageUpstream();
    servers.push(upstream);
    const { fetchImageWithServerCache } = await imageCache();

    const result = await fetchImageWithServerCache({
      cacheKey: `harness-${format}`,
      upstreamUrl: `${upstream.baseUrl}/image?format=${format}&delay=5`,
    });

    expect(result).toMatchObject({ status: 200, cacheStatus: 'BYPASS' });
    expect(upstream.requests).toHaveLength(1);
  });

  it.each([404, 429, 502])('returns configurable upstream status %s', async (status) => {
    const upstream = await createDeterministicImageUpstream();
    servers.push(upstream);
    const { fetchImageWithServerCache } = await imageCache();
    await expect(fetchImageWithServerCache({
      cacheKey: `harness-status-${status}`,
      upstreamUrl: `${upstream.baseUrl}/image?status=${status}`,
    })).resolves.toMatchObject({ status, body: null });
  });

  it('supports redirect validation, oversized streams, MIME confusion, and aborts', async () => {
    const upstream = await createDeterministicImageUpstream();
    servers.push(upstream);
    const { fetchImageWithServerCache } = await imageCache();

    await expect(fetchImageWithServerCache({
      cacheKey: 'harness-redirect',
      upstreamUrl: `${upstream.baseUrl}/redirect?redirect=/image?format=png`,
      isRedirectTargetAllowed: (target) => target.origin === upstream.baseUrl,
    })).resolves.toMatchObject({ status: 200, contentType: 'image/png' });
    await expect(fetchImageWithServerCache({
      cacheKey: 'harness-oversized',
      upstreamUrl: `${upstream.baseUrl}/image?bytes=1025`,
    })).resolves.toMatchObject({ status: 413, body: null });
    await expect(fetchImageWithServerCache({
      cacheKey: 'harness-mime',
      upstreamUrl: `${upstream.baseUrl}/image?format=jpeg&mime=image/png`,
    })).resolves.toMatchObject({ status: 415, body: null });
    await expect(fetchImageWithServerCache({
      cacheKey: 'harness-abort',
      upstreamUrl: `${upstream.baseUrl}/image?abort=true`,
    })).resolves.toMatchObject({ status: 502, body: null });
  });
});
