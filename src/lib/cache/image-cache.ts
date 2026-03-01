import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { getRedisClient } from '@/lib/redis';
import {
  IMAGE_CACHE_DIR,
  IMAGE_CACHE_STALE_SECONDS,
  IMAGE_CACHE_TTL_SECONDS,
} from '@/lib/cache/config';
import { buildImageMetaKey, sha256Hex } from '@/lib/cache/keys';
import {
  getCacheGeneration,
  getCacheImagesEnabled,
  tryAcquireCacheLock,
} from '@/lib/cache/state';

export type ImageCacheStatus = 'BYPASS' | 'HIT' | 'MISS' | 'REVALIDATED' | 'STALE';

export interface FetchCachedImageOptions {
  cacheKey: string;
  upstreamUrl: string;
  upstreamHeaders?: HeadersInit;
  ttlSeconds?: number;
  staleSeconds?: number;
}

export interface FetchCachedImageResult {
  status: number;
  body: Buffer | null;
  contentType: string | null;
  cacheStatus: ImageCacheStatus;
}

interface ImageCacheMeta {
  generation: number;
  relativePath: string;
  contentType: string;
  sizeBytes: number;
  fetchedAt: number;
  expiresAt: number;
  staleUntil: number;
}

function supportsStaleForStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function filePathFromMeta(meta: ImageCacheMeta): string {
  return path.join(IMAGE_CACHE_DIR, meta.relativePath);
}

async function readImageMeta(metaKey: string): Promise<ImageCacheMeta | null> {
  try {
    const redis = await getRedisClient();
    const raw = await redis.get(metaKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ImageCacheMeta>;

    if (
      typeof parsed.relativePath !== 'string'
      || typeof parsed.contentType !== 'string'
      || typeof parsed.generation !== 'number'
      || typeof parsed.fetchedAt !== 'number'
      || typeof parsed.expiresAt !== 'number'
      || typeof parsed.staleUntil !== 'number'
    ) {
      return null;
    }

    return {
      generation: parsed.generation,
      relativePath: parsed.relativePath,
      contentType: parsed.contentType,
      sizeBytes: typeof parsed.sizeBytes === 'number' ? parsed.sizeBytes : 0,
      fetchedAt: parsed.fetchedAt,
      expiresAt: parsed.expiresAt,
      staleUntil: parsed.staleUntil,
    };
  } catch {
    return null;
  }
}

async function writeImageMeta(metaKey: string, meta: ImageCacheMeta, nowMs: number): Promise<void> {
  try {
    const redis = await getRedisClient();
    const ttlSeconds = Math.max(1, Math.ceil((meta.staleUntil - nowMs) / 1000));
    await redis.set(metaKey, JSON.stringify(meta), { EX: ttlSeconds });
  } catch {
    // noop
  }
}

async function removeImageMeta(metaKey: string): Promise<void> {
  try {
    const redis = await getRedisClient();
    await redis.del(metaKey);
  } catch {
    // noop
  }
}

async function loadCachedImage(meta: ImageCacheMeta): Promise<Buffer | null> {
  try {
    return await readFile(filePathFromMeta(meta));
  } catch {
    return null;
  }
}

async function saveCachedImage(generation: number, keyHash: string, content: Buffer): Promise<string> {
  const relativePath = path.join(`v${generation}`, `${keyHash}.bin`);
  const absolutePath = path.join(IMAGE_CACHE_DIR, relativePath);
  const directory = path.dirname(absolutePath);
  const tempPath = `${absolutePath}.tmp-${randomUUID()}`;

  await mkdir(directory, { recursive: true });
  await writeFile(tempPath, content);
  await rename(tempPath, absolutePath);

  return relativePath;
}

async function fetchUpstreamImage(url: string, headers?: HeadersInit): Promise<{ status: number; ok: boolean; body: Buffer | null; contentType: string | null }> {
  const response = await fetch(url, { headers, cache: 'no-store' });
  if (!response.ok) {
    return {
      status: response.status,
      ok: false,
      body: null,
      contentType: null,
    };
  }

  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const body = Buffer.from(await response.arrayBuffer());

  return {
    status: response.status,
    ok: true,
    body,
    contentType,
  };
}

async function fetchBypass(url: string, headers?: HeadersInit): Promise<FetchCachedImageResult> {
  const upstream = await fetchUpstreamImage(url, headers);
  return {
    status: upstream.status,
    body: upstream.body,
    contentType: upstream.contentType,
    cacheStatus: 'BYPASS',
  };
}

export async function fetchImageWithServerCache(options: FetchCachedImageOptions): Promise<FetchCachedImageResult> {
  const enabled = await getCacheImagesEnabled();
  if (!enabled) {
    return fetchBypass(options.upstreamUrl, options.upstreamHeaders);
  }

  const generation = await getCacheGeneration();
  const cacheKey = options.cacheKey;
  const keyHash = sha256Hex(cacheKey);
  const metaKey = buildImageMetaKey(generation, cacheKey);
  const ttlSeconds = options.ttlSeconds ?? IMAGE_CACHE_TTL_SECONDS;
  const staleSeconds = options.staleSeconds ?? IMAGE_CACHE_STALE_SECONDS;
  const now = Date.now();

  const cachedMeta = await readImageMeta(metaKey);
  if (cachedMeta && now < cachedMeta.expiresAt) {
    const cachedBody = await loadCachedImage(cachedMeta);
    if (cachedBody) {
      return {
        status: 200,
        body: cachedBody,
        contentType: cachedMeta.contentType,
        cacheStatus: 'HIT',
      };
    }

    await removeImageMeta(metaKey);
  }

  const hasLock = await tryAcquireCacheLock('image', `${generation}:${cacheKey}`);
  if (!hasLock && cachedMeta && now < cachedMeta.staleUntil) {
    const staleBody = await loadCachedImage(cachedMeta);
    if (staleBody) {
      return {
        status: 200,
        body: staleBody,
        contentType: cachedMeta.contentType,
        cacheStatus: 'STALE',
      };
    }
  }

  try {
    const upstream = await fetchUpstreamImage(options.upstreamUrl, options.upstreamHeaders);
    if (upstream.ok && upstream.body) {
      const relativePath = await saveCachedImage(generation, keyHash, upstream.body);
      const nextMeta: ImageCacheMeta = {
        generation,
        relativePath,
        contentType: upstream.contentType || 'image/jpeg',
        sizeBytes: upstream.body.byteLength,
        fetchedAt: now,
        expiresAt: now + ttlSeconds * 1000,
        staleUntil: now + (ttlSeconds + staleSeconds) * 1000,
      };

      await writeImageMeta(metaKey, nextMeta, now);

      return {
        status: 200,
        body: upstream.body,
        contentType: nextMeta.contentType,
        cacheStatus: cachedMeta ? 'REVALIDATED' : 'MISS',
      };
    }

    if (cachedMeta && now < cachedMeta.staleUntil && supportsStaleForStatus(upstream.status)) {
      const staleBody = await loadCachedImage(cachedMeta);
      if (staleBody) {
        return {
          status: 200,
          body: staleBody,
          contentType: cachedMeta.contentType,
          cacheStatus: 'STALE',
        };
      }
    }

    return {
      status: upstream.status,
      body: null,
      contentType: null,
      cacheStatus: cachedMeta ? 'REVALIDATED' : 'MISS',
    };
  } catch {
    if (cachedMeta && now < cachedMeta.staleUntil) {
      const staleBody = await loadCachedImage(cachedMeta);
      if (staleBody) {
        return {
          status: 200,
          body: staleBody,
          contentType: cachedMeta.contentType,
          cacheStatus: 'STALE',
        };
      }
    }

    return {
      status: 502,
      body: null,
      contentType: null,
      cacheStatus: cachedMeta ? 'REVALIDATED' : 'MISS',
    };
  }
}

export async function deleteCachedImageFile(meta: ImageCacheMeta): Promise<void> {
  try {
    await unlink(filePathFromMeta(meta));
  } catch {
    // noop
  }
}
