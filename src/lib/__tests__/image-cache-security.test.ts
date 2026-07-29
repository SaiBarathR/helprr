import { mkdtempSync, readdirSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isImageResponseCacheable } from '@/lib/image-response-cache-policy';

const mocks = vi.hoisted(() => ({
  getCacheImagesEnabled: vi.fn(),
  getRedisClient: vi.fn(),
}));

vi.mock('@/lib/cache/state', () => ({
  getCacheImagesEnabled: mocks.getCacheImagesEnabled,
}));
vi.mock('@/lib/redis', () => ({
  getRedisClient: mocks.getRedisClient,
}));

const temporaryRoots: string[] = [];

class CacheRedis {
  readonly values = new Map<string, string>([['helprr:cache:generation', '1']]);
  readonly hashes = new Map<string, Record<string, string>>();
  rateCalls = 0;
  failRegister = false;

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(
    key: string,
    value: string,
    options?: { NX?: boolean; PX?: number },
  ): Promise<string | null> {
    if (options?.NX && this.values.has(key)) return null;
    this.values.set(key, value);
    return 'OK';
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    return { ...(this.hashes.get(key) ?? {}) };
  }

  async eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown> {
    if (script.includes('image-cache-release-lock-v1')) {
      if (this.values.get(options.keys[0]) === options.arguments[0]) {
        this.values.delete(options.keys[0]);
        return 1;
      }
      return 0;
    }
    if (script.includes('image-cache-rate-limit-v1')) {
      this.rateCalls += 1;
      return [String(this.rateCalls), '60000'];
    }
    if (script.includes('image-cache-register-v2')) {
      if (this.failRegister) throw new Error('Redis write failed');
      if (this.values.get(options.keys[4]) !== options.arguments[6]) {
        return ['GENERATION_CHANGED'];
      }
      if (this.values.get(options.keys[5]) !== options.arguments[7]) {
        return ['LOCK_LOST'];
      }
      const previous = this.hashes.get(options.keys[1])?.[options.arguments[0]] ?? '';
      this.values.set(options.keys[0], options.arguments[1]);
      const index = { ...(this.hashes.get(options.keys[1]) ?? {}) };
      index[options.arguments[0]] = options.arguments[3];
      this.hashes.set(options.keys[1], index);
      const size = JSON.parse(options.arguments[3]).sizeBytes as number;
      this.hashes.set(options.keys[3], { bytes: String(size), entries: '1' });
      return [previous, '[]', String(size), '1'];
    }
    if (script.includes('image-cache-touch-v1')) return 1;
    if (script.includes('image-cache-observe-v1')) return 1;
    if (script.includes('image-cache-remove-v1')) return '';
    throw new Error('Unexpected fake Redis script');
  }
}

async function loadImageCache(options: {
  maxBytes?: number;
  maxPixels?: number;
  cacheDir?: string;
} = {}) {
  process.env.IMAGE_UPSTREAM_MAX_BYTES = String(options.maxBytes ?? 1024);
  process.env.IMAGE_UPSTREAM_MAX_PIXELS = String(options.maxPixels ?? 100);
  if (options.cacheDir) process.env.IMAGE_CACHE_DIR = options.cacheDir;
  else delete process.env.IMAGE_CACHE_DIR;
  vi.resetModules();
  return import('@/lib/cache/image-cache');
}

function chunkedResponse(
  chunks: Uint8Array[],
  headers: HeadersInit = {},
): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }), { status: 200, headers });
}

async function fixture(
  format: 'jpeg' | 'png' | 'webp',
  width = 2,
  height = 2,
): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 20, g: 40, b: 60 },
    },
  }).toFormat(format).toBuffer();
}

function responseBody(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCacheImagesEnabled.mockResolvedValue(false);
  mocks.getRedisClient.mockRejectedValue(new Error('Redis unavailable'));
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.IMAGE_UPSTREAM_MAX_BYTES;
  delete process.env.IMAGE_UPSTREAM_MAX_PIXELS;
  delete process.env.IMAGE_CACHE_DIR;
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('bounded upstream image validation', () => {
  it('keeps no-store and accounting-bypass responses out of the PWA image cache', () => {
    expect(isImageResponseCacheable(new Response(null, {
      status: 200,
      headers: {
        'cache-control': 'private, no-store',
        'x-helprr-cache': 'BYPASS',
      },
    }))).toBe(false);
    expect(isImageResponseCacheable(new Response(null, {
      status: 200,
      headers: { 'x-helprr-cache': 'MISS' },
    }))).toBe(true);
    expect(isImageResponseCacheable(new Response(null, { status: 403 }))).toBe(false);
  });

  it('accepts a valid image exactly at the configured byte limit', async () => {
    const body = await fixture('jpeg');
    const { fetchImageWithServerCache } = await loadImageCache({
      maxBytes: body.byteLength,
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(responseBody(body), {
      headers: {
        'content-length': String(body.byteLength),
        'content-type': 'image/jpeg',
      },
    })));

    const result = await fetchImageWithServerCache({
      cacheKey: 'exact-limit',
      upstreamUrl: 'https://images.example.com/image.jpg',
    });

    expect(result).toMatchObject({
      status: 200,
      contentType: 'image/jpeg',
      cacheStatus: 'BYPASS',
    });
  });

  it.each([
    ['jpeg', 'image/jpeg'],
    ['png', 'image/png'],
    ['webp', 'image/webp'],
  ] as const)('serves validated %s bytes with a byte-derived content type', async (format, contentType) => {
    const body = await fixture(format);
    const { fetchImageWithServerCache } = await loadImageCache({ maxBytes: 2048 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(responseBody(body))));

    const result = await fetchImageWithServerCache({
      cacheKey: `fixture:${format}`,
      upstreamUrl: `https://images.example.com/image.${format}`,
    });

    expect(result).toMatchObject({
      status: 200,
      contentType,
      cacheStatus: 'BYPASS',
    });
    expect(result.body).toEqual(body);
  });

  it('rejects a declared-large body before consuming it and aborts the fetch', async () => {
    let cancelled = false;
    let aborted = false;
    const response = new Response(new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }), {
      headers: {
        'content-length': '17',
        'content-type': 'image/png',
      },
    });
    const { fetchImageWithServerCache } = await loadImageCache({ maxBytes: 16 });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      init.signal?.addEventListener('abort', () => {
        aborted = true;
      });
      return response;
    }));

    const result = await fetchImageWithServerCache({
      cacheKey: 'declared-large',
      upstreamUrl: 'https://images.example.com/image.png',
    });

    expect(result).toMatchObject({ status: 413, body: null });
    expect(cancelled).toBe(true);
    expect(aborted).toBe(true);
  });

  it('pre-rejects an arbitrarily large numeric Content-Length', async () => {
    const { fetchImageWithServerCache } = await loadImageCache({ maxBytes: 16 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, {
      headers: { 'content-length': '999999999999999999999999999999' },
    })));

    const result = await fetchImageWithServerCache({
      cacheKey: 'huge-declared-length',
      upstreamUrl: 'https://images.example.com/image.png',
    });

    expect(result).toMatchObject({ status: 413, body: null });
  });

  it.each([
    ['missing length', {}],
    ['spoofed short length', { 'content-length': '1' }],
    ['malformed length', { 'content-length': 'not-a-number' }],
  ])('aborts an actually oversized chunked response with %s', async (_name, headers) => {
    const { fetchImageWithServerCache } = await loadImageCache({ maxBytes: 16 });
    vi.stubGlobal('fetch', vi.fn(async () => chunkedResponse(
      [new Uint8Array(8), new Uint8Array(9)],
      headers,
    )));

    const result = await fetchImageWithServerCache({
      cacheKey: 'actual-large',
      upstreamUrl: 'https://images.example.com/image.png',
    });

    expect(result).toMatchObject({ status: 413, body: null });
  });

  it.each([
    ['HTML', Buffer.from('<!doctype html><title>not an image</title>'), 'text/html'],
    ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'image/svg+xml'],
    ['XML', Buffer.from('<?xml version="1.0"?><image/>'), 'application/xml'],
    ['malformed raster', Buffer.from([0xff, 0xd8, 0xff, 0x00]), 'image/jpeg'],
    ['unknown bytes', Buffer.from('not-an-image'), null],
  ])('rejects %s bytes', async (_name, body, contentType) => {
    const { fetchImageWithServerCache } = await loadImageCache();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(responseBody(body), {
      headers: contentType ? { 'content-type': contentType } : {},
    })));

    const result = await fetchImageWithServerCache({
      cacheKey: 'invalid',
      upstreamUrl: 'https://images.example.com/image',
    });

    expect(result).toMatchObject({ status: 415, body: null });
  });

  it('rejects MIME-confused bytes instead of trusting or rewriting the header', async () => {
    const jpeg = await fixture('jpeg');
    const { fetchImageWithServerCache } = await loadImageCache({ maxBytes: 2048 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(responseBody(jpeg), {
      headers: { 'content-type': 'image/png' },
    })));

    const result = await fetchImageWithServerCache({
      cacheKey: 'mime-confused',
      upstreamUrl: 'https://images.example.com/image.png',
    });

    expect(result).toMatchObject({ status: 415, body: null, contentType: null });
  });

  it('rejects a valid but unsupported GIF raster', async () => {
    const gif = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: { r: 20, g: 40, b: 60 },
      },
    }).gif().toBuffer();
    const { fetchImageWithServerCache } = await loadImageCache({ maxBytes: 2048 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(responseBody(gif), {
      headers: { 'content-type': 'image/gif' },
    })));

    const result = await fetchImageWithServerCache({
      cacheKey: 'unsupported-gif',
      upstreamUrl: 'https://images.example.com/image.gif',
    });

    expect(result).toMatchObject({ status: 415, body: null });
  });

  it('enforces the explicit Sharp input-pixel cap', async () => {
    const png = await fixture('png', 3, 2);
    const { fetchImageWithServerCache } = await loadImageCache({
      maxBytes: 2048,
      maxPixels: 5,
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(responseBody(png), {
      headers: { 'content-type': 'image/png' },
    })));

    const result = await fetchImageWithServerCache({
      cacheKey: 'pixel-heavy',
      upstreamUrl: 'https://images.example.com/image.png',
    });

    expect(result).toMatchObject({ status: 415, body: null });
  });

  it('strips redirect fragments before validation/fetch and removes cross-origin credentials', async () => {
    const jpeg = await fixture('jpeg');
    const calls: Array<{ url: string; headers: HeadersInit | undefined }> = [];
    const allowedTargets: URL[] = [];
    const { fetchImageWithServerCache } = await loadImageCache({ maxBytes: 2048 });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers });
      if (calls.length === 1) {
        return new Response(null, {
          status: 302,
          headers: {
            location: 'https://cdn.example.com/image.jpg#not-sent',
          },
        });
      }
      return new Response(responseBody(jpeg), {
        headers: { 'content-type': 'image/jpeg' },
      });
    }));

    const result = await fetchImageWithServerCache({
      cacheKey: 'redirect',
      upstreamUrl: 'https://origin.example.com/image.jpg#initial-fragment',
      upstreamHeaders: { Authorization: 'secret' },
      isRedirectTargetAllowed: (target) => {
        allowedTargets.push(new URL(target));
        return target.hostname === 'cdn.example.com';
      },
    });

    expect(result.status).toBe(200);
    expect(calls).toEqual([
      {
        url: 'https://origin.example.com/image.jpg',
        headers: { Authorization: 'secret' },
      },
      {
        url: 'https://cdn.example.com/image.jpg',
        headers: undefined,
      },
    ]);
    expect(allowedTargets[0]?.hash).toBe('');
  });

  it('fails closed when a redirect target does not pass SSRF validation', async () => {
    const upstreamFetch = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/private.png#fragment' },
    }));
    const { fetchImageWithServerCache } = await loadImageCache();
    vi.stubGlobal('fetch', upstreamFetch);
    const validateTarget = vi.fn((target: URL) => target.protocol === 'file:');

    const result = await fetchImageWithServerCache({
      cacheKey: 'redirect-ssrf',
      upstreamUrl: 'https://images.example.com/image.png',
      isRedirectTargetAllowed: validateTarget,
    });

    expect(result).toMatchObject({ status: 502, body: null });
    expect(upstreamFetch).toHaveBeenCalledOnce();
    expect(validateTarget).toHaveBeenCalledOnce();
    expect(validateTarget.mock.calls[0]?.[0].hash).toBe('');
  });

  it('serves a bounded validated image with no cache write when Redis accounting is unavailable', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'helprr-image-no-redis-'));
    temporaryRoots.push(root);
    const jpeg = await fixture('jpeg');
    mocks.getCacheImagesEnabled.mockResolvedValue(true);
    const { fetchImageWithServerCache } = await loadImageCache({
      maxBytes: 2048,
      cacheDir: root,
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(responseBody(jpeg), {
      headers: { 'content-type': 'image/jpeg' },
    })));

    const result = await fetchImageWithServerCache({
      cacheKey: 'redis-down',
      upstreamUrl: 'https://images.example.com/image.jpg',
      requesterId: 'user-1',
    });

    expect(result).toMatchObject({
      status: 200,
      cacheStatus: 'BYPASS',
      contentType: 'image/jpeg',
    });
    expect(readdirSync(root)).toEqual([]);
  });

  it('bounds concurrent image fetch and decode work per authenticated user', async () => {
    const jpeg = await fixture('jpeg');
    const { fetchImageWithServerCache } = await loadImageCache({ maxBytes: 2048 });
    let releaseFetches!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFetches = resolve;
    });
    const upstreamFetch = vi.fn(async () => {
      await gate;
      return new Response(responseBody(jpeg), {
        headers: { 'content-type': 'image/jpeg' },
      });
    });
    vi.stubGlobal('fetch', upstreamFetch);

    const requests = Array.from({ length: 5 }, (_, index) => (
      fetchImageWithServerCache({
        cacheKey: `concurrent-${index}`,
        upstreamUrl: `https://images.example.com/image-${index}.jpg`,
        requesterId: 'same-user',
      })
    ));

    await vi.waitFor(() => expect(upstreamFetch).toHaveBeenCalledTimes(4));
    await expect(requests[4]).resolves.toMatchObject({
      status: 429,
      retryAfterSeconds: 1,
    });
    releaseFetches();
    await expect(Promise.all(requests.slice(0, 4))).resolves.toHaveLength(4);
  });

  it('charges the per-user limiter only for the upstream fill, not the cache hit', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'helprr-image-cache-hit-'));
    temporaryRoots.push(root);
    const jpeg = await fixture('jpeg');
    const redis = new CacheRedis();
    mocks.getCacheImagesEnabled.mockResolvedValue(true);
    mocks.getRedisClient.mockResolvedValue(redis);
    const { fetchImageWithServerCache } = await loadImageCache({
      maxBytes: 2048,
      cacheDir: root,
    });
    const upstreamFetch = vi.fn(async () => new Response(responseBody(jpeg), {
      headers: { 'content-type': 'image/jpeg' },
    }));
    vi.stubGlobal('fetch', upstreamFetch);
    const options = {
      cacheKey: 'cache-hit',
      upstreamUrl: 'https://images.example.com/image.jpg',
      requesterId: 'user-1',
    };

    const first = await fetchImageWithServerCache(options);
    const second = await fetchImageWithServerCache(options);

    expect(first.cacheStatus).toBe('MISS');
    expect(second.cacheStatus).toBe('HIT');
    expect(upstreamFetch).toHaveBeenCalledOnce();
    expect(redis.rateCalls).toBe(1);
  });

  it('removes a just-written file when Redis registration fails', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'helprr-image-register-failure-'));
    temporaryRoots.push(root);
    const jpeg = await fixture('jpeg');
    const redis = new CacheRedis();
    redis.failRegister = true;
    mocks.getCacheImagesEnabled.mockResolvedValue(true);
    mocks.getRedisClient.mockResolvedValue(redis);
    const { fetchImageWithServerCache } = await loadImageCache({
      maxBytes: 2048,
      cacheDir: root,
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(responseBody(jpeg), {
      headers: { 'content-type': 'image/jpeg' },
    })));

    const result = await fetchImageWithServerCache({
      cacheKey: 'registration-fails',
      upstreamUrl: 'https://images.example.com/image.jpg',
      requesterId: 'user-1',
    });

    expect(result).toMatchObject({ status: 200, cacheStatus: 'BYPASS' });
    expect(readdirSync(path.join(root, 'v1'))).toEqual([]);
  });

  it('does not recreate a purged generation after an in-flight fetch finishes', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'helprr-image-generation-race-'));
    temporaryRoots.push(root);
    const jpeg = await fixture('jpeg');
    const redis = new CacheRedis();
    mocks.getCacheImagesEnabled.mockResolvedValue(true);
    mocks.getRedisClient.mockResolvedValue(redis);
    const { fetchImageWithServerCache } = await loadImageCache({
      maxBytes: 2048,
      cacheDir: root,
    });
    let releaseFetch!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const upstreamFetch = vi.fn(async () => {
      await gate;
      return new Response(responseBody(jpeg), {
        headers: { 'content-type': 'image/jpeg' },
      });
    });
    vi.stubGlobal('fetch', upstreamFetch);

    const request = fetchImageWithServerCache({
      cacheKey: 'generation-race',
      upstreamUrl: 'https://images.example.com/image.jpg',
      requesterId: 'user-1',
    });
    await vi.waitFor(() => expect(upstreamFetch).toHaveBeenCalledOnce());
    redis.values.set('helprr:cache:generation', '2');
    releaseFetch();

    await expect(request).resolves.toMatchObject({
      status: 200,
      cacheStatus: 'BYPASS',
    });
    expect(readdirSync(path.join(root, 'v1'))).toEqual([]);
  });
});
