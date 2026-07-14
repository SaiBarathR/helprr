import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { getRedisClient } from '@/lib/redis';
import {
  IMAGE_CACHE_DIR,
  IMAGE_CACHE_STALE_SECONDS,
  IMAGE_CACHE_TTL_SECONDS,
  IMAGE_UPSTREAM_FETCH_TIMEOUT_MS,
} from '@/lib/cache/config';
import { buildImageMetaKey, sha256Hex } from '@/lib/cache/keys';
import {
  getCacheGeneration,
  getCacheImagesEnabled,
  releaseCacheLock,
  tryAcquireCacheLock,
} from '@/lib/cache/state';

export type ImageCacheStatus = 'BYPASS' | 'HIT' | 'MISS' | 'REVALIDATED' | 'STALE';

export interface ImageTransform {
  width?: number;
}

export interface FetchCachedImageOptions {
  cacheKey: string;
  upstreamUrl: string;
  upstreamHeaders?: HeadersInit;
  ttlSeconds?: number;
  staleSeconds?: number;
  transform?: ImageTransform;
  /**
   * Called for each redirect target before it is followed. Only the initial
   * upstream URL is validated by the caller, so without this check a 30x from
   * an allowlisted host could point the proxy at an internal address (SSRF).
   * When omitted, redirects are not followed at all.
   */
  isRedirectTargetAllowed?: (target: URL) => boolean;
}

export interface FetchCachedImageResult {
  status: number;
  body: Buffer | null;
  contentType: string | null;
  cacheStatus: ImageCacheStatus;
}

export interface ImageCacheMeta {
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
  // Immutable filenames make metadata replacement and orphan cleanup safe to
  // race: a refresh never overwrites the file referenced by older metadata.
  const relativePath = path.join(`v${generation}`, `${keyHash}-${randomUUID()}.bin`);
  const absolutePath = path.join(IMAGE_CACHE_DIR, relativePath);
  const directory = path.dirname(absolutePath);
  const tempPath = `${absolutePath}.tmp-${randomUUID()}`;

  await mkdir(directory, { recursive: true });
  await writeFile(tempPath, content);
  await rename(tempPath, absolutePath);

  return relativePath;
}

function isFetchAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }

  if (error instanceof Error) {
    const maybeCode = (error as Error & { code?: string }).code;
    return error.name === 'AbortError' || maybeCode === 'ABORT_ERR';
  }

  if (typeof error === 'object' && error !== null && 'name' in error) {
    return (error as { name?: string }).name === 'AbortError';
  }

  return false;
}

const MAX_IMAGE_REDIRECTS = 3;

async function fetchUpstreamImage(
  url: string,
  headers?: HeadersInit,
  isRedirectTargetAllowed?: (target: URL) => boolean,
): Promise<{ status: number; ok: boolean; body: Buffer | null; contentType: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_UPSTREAM_FETCH_TIMEOUT_MS);

  try {
    let currentUrl = url;
    let currentHeaders = headers;

    // Redirects are followed manually so every hop is re-validated against the
    // caller's allowlist — `redirect: 'follow'` would let an allowlisted host
    // 30x the proxy to an internal address.
    for (let hop = 0; ; hop++) {
      const response = await fetch(currentUrl, {
        headers: currentHeaders,
        cache: 'no-store',
        signal: controller.signal,
        redirect: 'manual',
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || hop >= MAX_IMAGE_REDIRECTS) {
          return { status: 502, ok: false, body: null, contentType: null };
        }

        let target: URL;
        try {
          target = new URL(location, currentUrl);
        } catch {
          return { status: 502, ok: false, body: null, contentType: null };
        }

        if (
          (target.protocol !== 'http:' && target.protocol !== 'https:')
          || !isRedirectTargetAllowed?.(target)
        ) {
          return { status: 502, ok: false, body: null, contentType: null };
        }

        // Never leak the upstream's auth header to a different origin.
        if (target.origin !== new URL(currentUrl).origin) {
          currentHeaders = undefined;
        }
        currentUrl = target.toString();
        continue;
      }

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
  } catch (error) {
    if (isFetchAbortError(error)) {
      return {
        status: 504,
        ok: false,
        body: null,
        contentType: null,
      };
    }

    return {
      status: 502,
      ok: false,
      body: null,
      contentType: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

const WEBP_TRANSFORM_QUALITY = 78;
const TRANSFORMABLE_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Transcode raster images to right-sized WebP. SVG/GIF (and anything else) pass
// through untouched, and any sharp failure falls back to the original bytes so a
// bad image never breaks the response.
async function applyImageTransform(
  body: Buffer,
  contentType: string,
  transform: ImageTransform | undefined,
): Promise<{ body: Buffer; contentType: string }> {
  if (!transform) return { body, contentType };

  const baseType = contentType.split(';')[0].trim().toLowerCase();
  if (!TRANSFORMABLE_CONTENT_TYPES.has(baseType)) {
    return { body, contentType };
  }

  try {
    const pipeline = sharp(body);
    if (transform.width) {
      pipeline.resize({ width: transform.width, withoutEnlargement: true });
    }
    const output = await pipeline.webp({ quality: WEBP_TRANSFORM_QUALITY }).toBuffer();
    return { body: output, contentType: 'image/webp' };
  } catch {
    return { body, contentType };
  }
}

async function fetchBypass(
  url: string,
  headers: HeadersInit | undefined,
  transform: ImageTransform | undefined,
  isRedirectTargetAllowed?: (target: URL) => boolean,
): Promise<FetchCachedImageResult> {
  const upstream = await fetchUpstreamImage(url, headers, isRedirectTargetAllowed);
  if (!upstream.ok || !upstream.body) {
    return {
      status: upstream.status,
      body: upstream.body,
      contentType: upstream.contentType,
      cacheStatus: 'BYPASS',
    };
  }

  const transformed = await applyImageTransform(upstream.body, upstream.contentType || 'image/jpeg', transform);
  return {
    status: upstream.status,
    body: transformed.body,
    contentType: transformed.contentType,
    cacheStatus: 'BYPASS',
  };
}

export async function fetchImageWithServerCache(options: FetchCachedImageOptions): Promise<FetchCachedImageResult> {
  const enabled = await getCacheImagesEnabled();
  if (!enabled) {
    // Caching is off: every request re-fetches AND re-transcodes (sharp) with no
    // memoization — the cost the cache normally amortizes is paid each time. This is
    // an explicit admin opt-out (debugging / reclaiming disk), not a hot-path default.
    return fetchBypass(options.upstreamUrl, options.upstreamHeaders, options.transform, options.isRedirectTargetAllowed);
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

  const lockToken = await tryAcquireCacheLock('image', `${generation}:${cacheKey}`);
  if (!lockToken && cachedMeta && now < cachedMeta.staleUntil) {
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
    const upstream = await fetchUpstreamImage(options.upstreamUrl, options.upstreamHeaders, options.isRedirectTargetAllowed);
    if (upstream.ok && upstream.body) {
      const transformed = await applyImageTransform(upstream.body, upstream.contentType || 'image/jpeg', options.transform);
      const relativePath = await saveCachedImage(generation, keyHash, transformed.body);
      const nextMeta: ImageCacheMeta = {
        generation,
        relativePath,
        contentType: transformed.contentType,
        sizeBytes: transformed.body.byteLength,
        fetchedAt: now,
        expiresAt: now + ttlSeconds * 1000,
        staleUntil: now + (ttlSeconds + staleSeconds) * 1000,
      };

      await writeImageMeta(metaKey, nextMeta, now);

      return {
        status: 200,
        body: transformed.body,
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
  } finally {
    if (lockToken) {
      void releaseCacheLock('image', `${generation}:${cacheKey}`, lockToken);
    }
  }
}

export async function deleteCachedImageFile(meta: ImageCacheMeta): Promise<void> {
  try {
    await unlink(filePathFromMeta(meta));
  } catch {
    // noop
  }
}
