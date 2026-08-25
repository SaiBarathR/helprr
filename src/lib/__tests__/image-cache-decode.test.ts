import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCacheImagesEnabled: vi.fn(),
  getRedisClient: vi.fn(),
  metadata: vi.fn(),
  stats: vi.fn(),
  toBuffer: vi.fn(),
  sharp: vi.fn(),
}));

vi.mock('@/lib/cache/state', () => ({
  getCacheImagesEnabled: mocks.getCacheImagesEnabled,
}));
vi.mock('@/lib/redis', () => ({ getRedisClient: mocks.getRedisClient }));
vi.mock('sharp', () => ({ default: mocks.sharp }));

describe('image validation decode work', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCacheImagesEnabled.mockResolvedValue(false);
    mocks.getRedisClient.mockRejectedValue(new Error('Redis unavailable'));
    mocks.metadata.mockResolvedValue({
      format: 'jpeg',
      width: 400,
      height: 600,
      pages: 1,
    });
    mocks.stats.mockResolvedValue({});
    mocks.toBuffer.mockResolvedValue(Buffer.from('transformed'));
    mocks.sharp.mockImplementation(() => ({
      metadata: mocks.metadata,
      stats: mocks.stats,
      resize() { return this; },
      webp() { return this; },
      toBuffer: mocks.toBuffer,
    }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.from('jpeg-input'), {
      headers: { 'content-type': 'image/jpeg' },
    })));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('uses the transform as the only full decode for re-encoded images', async () => {
    const { fetchImageWithServerCache } = await import('@/lib/cache/image-cache');

    await expect(fetchImageWithServerCache({
      cacheKey: 'single-decode',
      upstreamUrl: 'https://images.example.com/poster.jpg',
      transform: { width: 360 },
    })).resolves.toMatchObject({ status: 200, contentType: 'image/webp' });

    expect(mocks.metadata).toHaveBeenCalledOnce();
    expect(mocks.stats).not.toHaveBeenCalled();
    expect(mocks.toBuffer).toHaveBeenCalledOnce();
  });

  it('keeps a full-decode validation probe for pass-through images', async () => {
    const { fetchImageWithServerCache } = await import('@/lib/cache/image-cache');

    await expect(fetchImageWithServerCache({
      cacheKey: 'pass-through-decode',
      upstreamUrl: 'https://images.example.com/poster.jpg',
    })).resolves.toMatchObject({ status: 200, contentType: 'image/jpeg' });

    expect(mocks.metadata).toHaveBeenCalledOnce();
    expect(mocks.stats).toHaveBeenCalledOnce();
    expect(mocks.toBuffer).not.toHaveBeenCalled();
  });
});
