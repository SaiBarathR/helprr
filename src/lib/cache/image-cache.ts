import { randomUUID } from 'crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import {
  acquireImageFillLock,
  acquireImageProcessingLease,
  acquireImageQuotaLock,
  enforceImageFetchRateLimit,
  type ImageAccountingRedis,
  type ImageIndexEntry,
  type ImageProcessingLease,
  recordImageObservation,
  registerImageCacheEntry,
  releaseImageFillLock,
  releaseImageProcessingLease,
  releaseImageQuotaLock,
  removeImageCacheEntry,
  touchImageCacheEntry,
} from '@/lib/cache/image-cache-accounting';
import {
  IMAGE_CACHE_DIR,
  IMAGE_CACHE_MAX_BYTES,
  IMAGE_CACHE_STALE_SECONDS,
  IMAGE_CACHE_TTL_SECONDS,
  IMAGE_UPSTREAM_FETCH_TIMEOUT_MS,
  IMAGE_UPSTREAM_MAX_BYTES,
  IMAGE_UPSTREAM_MAX_PIXELS,
} from '@/lib/cache/config';
import { buildImageMetaKey, sha256Hex } from '@/lib/cache/keys';
import { getCacheImagesEnabled } from '@/lib/cache/state';
import { getRedisClient } from '@/lib/redis';

export type ImageCacheStatus = 'BYPASS' | 'HIT' | 'MISS' | 'REVALIDATED' | 'STALE';
export type ValidatedImageFormat = 'jpeg' | 'png' | 'webp';

export interface ImageTransform {
  width?: number;
}

export interface FetchCachedImageOptions {
  cacheKey: string;
  upstreamUrl: string;
  upstreamHeaders?: HeadersInit;
  requesterId?: string;
  timeoutMs?: number;
  ttlSeconds?: number;
  staleSeconds?: number;
  transform?: ImageTransform;
  /**
   * Called for each fragment-free redirect target before it is followed. Only
   * the initial upstream URL is validated by the caller, so without this check
   * a 30x from an allowlisted host could point the proxy at an internal address.
   * When omitted, redirects are not followed at all.
   */
  isRedirectTargetAllowed?: (target: URL) => boolean;
}

export interface FetchCachedImageResult {
  status: number;
  body: Buffer | null;
  contentType: string | null;
  cacheStatus: ImageCacheStatus;
  retryAfterSeconds?: number;
}

const LOCAL_IMAGE_PROCESSING_GLOBAL_MAX = 16;
const LOCAL_IMAGE_PROCESSING_PER_USER_MAX = 4;
const LOCAL_IMAGE_PROCESSING_STATE_KEY = '__helprrImageProcessingState' as const;
interface LocalImageProcessingState {
  count: number;
  byUser: Map<string, number>;
}
const imageProcessingGlobal = globalThis as typeof globalThis & {
  [LOCAL_IMAGE_PROCESSING_STATE_KEY]?: LocalImageProcessingState;
};
const localImageProcessingState = (
  imageProcessingGlobal[LOCAL_IMAGE_PROCESSING_STATE_KEY] ??= {
    count: 0,
    byUser: new Map<string, number>(),
  }
);

interface BoundedImageProcessingLease {
  localUserKey: string;
  redisLease: ImageProcessingLease | null;
}

function acquireLocalImageProcessingLease(
  requesterId: string | undefined,
): string | null {
  const userKey = requesterId ?? 'anonymous';
  const userCount = localImageProcessingState.byUser.get(userKey) ?? 0;
  if (
    localImageProcessingState.count >= LOCAL_IMAGE_PROCESSING_GLOBAL_MAX
    || userCount >= LOCAL_IMAGE_PROCESSING_PER_USER_MAX
  ) {
    return null;
  }
  localImageProcessingState.count += 1;
  localImageProcessingState.byUser.set(userKey, userCount + 1);
  return userKey;
}

function releaseLocalImageProcessingLease(userKey: string): void {
  localImageProcessingState.count = Math.max(0, localImageProcessingState.count - 1);
  const next = Math.max(0, (localImageProcessingState.byUser.get(userKey) ?? 1) - 1);
  if (next === 0) localImageProcessingState.byUser.delete(userKey);
  else localImageProcessingState.byUser.set(userKey, next);
}

async function acquireBoundedImageProcessingLease(
  redis: ImageAccountingRedis | null,
  requesterId: string | undefined,
): Promise<BoundedImageProcessingLease | null> {
  const localUserKey = acquireLocalImageProcessingLease(requesterId);
  if (!localUserKey) return null;

  let redisLease: ImageProcessingLease | null = null;
  if (redis) {
    try {
      redisLease = await acquireImageProcessingLease(redis, requesterId);
      if (!redisLease) {
        releaseLocalImageProcessingLease(localUserKey);
        return null;
      }
    } catch {
      // The in-process limits still bound this instance during a Redis outage.
    }
  }
  return { localUserKey, redisLease };
}

async function releaseBoundedImageProcessingLease(
  redis: ImageAccountingRedis | null,
  lease: BoundedImageProcessingLease,
): Promise<void> {
  if (redis && lease.redisLease) {
    await releaseImageProcessingLease(redis, lease.redisLease).catch(() => undefined);
  }
  releaseLocalImageProcessingLease(lease.localUserKey);
}

export interface ImageCacheMeta {
  generation: number;
  relativePath: string;
  contentType: string;
  format: ValidatedImageFormat;
  sizeBytes: number;
  fetchedAt: number;
  expiresAt: number;
  staleUntil: number;
}

interface ValidatedUpstreamResult {
  status: number;
  ok: boolean;
  body: Buffer | null;
  contentType: string | null;
  format: ValidatedImageFormat | null;
  validatedBytes: number;
  host: string;
  rejection: 'oversized' | 'invalid-image' | null;
}

const MAX_IMAGE_REDIRECTS = 3;
const WEBP_TRANSFORM_QUALITY = 78;
const ACCEPTED_IMAGE_FORMATS = new Set<ValidatedImageFormat>(['jpeg', 'png', 'webp']);
const CONTENT_TYPE_BY_FORMAT: Record<ValidatedImageFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function supportsStaleForStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function parseGeneration(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function getStrictCacheGeneration(redis: ImageAccountingRedis): Promise<number> {
  let generation = parseGeneration(await redis.get('helprr:cache:generation'));
  if (generation) return generation;

  const initialized = await redis.set('helprr:cache:generation', '1', { NX: true });
  if (initialized === 'OK') return 1;
  generation = parseGeneration(await redis.get('helprr:cache:generation'));
  if (!generation) throw new Error('Image cache generation is unavailable');
  return generation;
}

function fragmentFreeUrl(input: string | URL): URL {
  const parsed = input instanceof URL ? new URL(input.toString()) : new URL(input);
  parsed.hash = '';
  return parsed;
}

function safeHost(input: string | URL): string {
  try {
    return fragmentFreeUrl(input).hostname.toLowerCase().slice(0, 255);
  } catch {
    return '';
  }
}

function filePathFromRelativePath(relativePath: string): string | null {
  const root = path.resolve(IMAGE_CACHE_DIR);
  const absolutePath = path.resolve(root, relativePath);
  return absolutePath.startsWith(`${root}${path.sep}`) ? absolutePath : null;
}

function filePathFromMeta(meta: ImageCacheMeta): string | null {
  return filePathFromRelativePath(meta.relativePath);
}

function validMetaPath(metaKey: string, generation: number, relativePath: string): boolean {
  const expectedPrefix = `helprr:cache:image:v${generation}:`;
  const keyHash = metaKey.startsWith(expectedPrefix) ? metaKey.slice(expectedPrefix.length) : '';
  if (!/^[0-9a-f]{64}$/i.test(keyHash)) return false;
  const normalized = path.normalize(relativePath);
  return (
    path.dirname(normalized) === `v${generation}`
    && path.basename(normalized).startsWith(`${keyHash}-`)
    && path.basename(normalized).endsWith('.bin')
    && filePathFromRelativePath(normalized) !== null
  );
}

async function readImageMeta(
  redis: ImageAccountingRedis,
  metaKey: string,
  generation: number,
): Promise<ImageCacheMeta | null> {
  const raw = await redis.get(metaKey);
  if (!raw || raw.length > 16_384) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<ImageCacheMeta>;
    const format = parsed.format;
    if (
      typeof parsed.relativePath !== 'string'
      || typeof parsed.contentType !== 'string'
      || parsed.generation !== generation
      || typeof parsed.sizeBytes !== 'number'
      || !Number.isSafeInteger(parsed.sizeBytes)
      || parsed.sizeBytes < 0
      || typeof parsed.fetchedAt !== 'number'
      || typeof parsed.expiresAt !== 'number'
      || typeof parsed.staleUntil !== 'number'
      || !format
      || !ACCEPTED_IMAGE_FORMATS.has(format)
      || CONTENT_TYPE_BY_FORMAT[format] !== parsed.contentType
      || !validMetaPath(metaKey, generation, parsed.relativePath)
    ) {
      return null;
    }

    return {
      generation,
      relativePath: parsed.relativePath,
      contentType: parsed.contentType,
      format,
      sizeBytes: parsed.sizeBytes,
      fetchedAt: parsed.fetchedAt,
      expiresAt: parsed.expiresAt,
      staleUntil: parsed.staleUntil,
    };
  } catch {
    return null;
  }
}

async function loadCachedImage(meta: ImageCacheMeta): Promise<Buffer | null> {
  const filePath = filePathFromMeta(meta);
  if (!filePath) return null;
  try {
    const body = await readFile(filePath);
    return body.byteLength === meta.sizeBytes ? body : null;
  } catch {
    return null;
  }
}

async function unlinkRelativePath(relativePath: string): Promise<void> {
  const filePath = filePathFromRelativePath(relativePath);
  if (!filePath) return;
  await unlink(filePath).catch(() => undefined);
}

async function saveCachedImage(
  generation: number,
  keyHash: string,
  content: Buffer,
): Promise<string> {
  // Immutable filenames make metadata replacement and orphan cleanup safe to
  // race: a refresh never overwrites the file referenced by older metadata.
  const relativePath = path.join(`v${generation}`, `${keyHash}-${randomUUID()}.bin`);
  const absolutePath = filePathFromRelativePath(relativePath);
  if (!absolutePath) throw new Error('Invalid image cache path');
  const directory = path.dirname(absolutePath);
  const tempPath = `${absolutePath}.tmp-${randomUUID()}`;

  await mkdir(directory, { recursive: true });
  try {
    await writeFile(tempPath, content, { flag: 'wx' });
    await rename(tempPath, absolutePath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }

  return relativePath;
}

function isFetchAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error) {
    const maybeCode = (error as Error & { code?: string }).code;
    return error.name === 'AbortError' || maybeCode === 'ABORT_ERR';
  }
  return (
    typeof error === 'object'
    && error !== null
    && 'name' in error
    && (error as { name?: string }).name === 'AbortError'
  );
}

function declaredContentLength(headers: Headers): number | null {
  const raw = headers.get('content-length');
  const normalized = raw?.trim();
  if (!normalized || !/^[0-9]+$/.test(normalized)) return null;
  try {
    const parsed = BigInt(normalized);
    if (parsed > BigInt(IMAGE_UPSTREAM_MAX_BYTES)) {
      return IMAGE_UPSTREAM_MAX_BYTES + 1;
    }
    return Number(parsed);
  } catch {
    return null;
  }
}

async function readBoundedResponseBody(
  response: Response,
  controller: AbortController,
): Promise<{ body: Buffer | null; oversized: boolean }> {
  const declared = declaredContentLength(response.headers);
  if (declared !== null && declared > IMAGE_UPSTREAM_MAX_BYTES) {
    controller.abort();
    await response.body?.cancel().catch(() => undefined);
    return { body: null, oversized: true };
  }

  if (!response.body) return { body: null, oversized: false };
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;

  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > IMAGE_UPSTREAM_MAX_BYTES) {
        controller.abort();
        await reader.cancel().catch(() => undefined);
        return { body: null, oversized: true };
      }
      chunks.push(Buffer.from(chunk.value));
    }
    return { body: Buffer.concat(chunks, bytes), oversized: false };
  } finally {
    reader.releaseLock();
  }
}

function canonicalDeclaredFormat(contentType: string | null): ValidatedImageFormat | null {
  if (!contentType) return null;
  const base = contentType.split(';', 1)[0]?.trim().toLowerCase();
  if (base === 'image/jpeg' || base === 'image/jpg' || base === 'image/pjpeg') return 'jpeg';
  if (base === 'image/png' || base === 'image/x-png') return 'png';
  if (base === 'image/webp') return 'webp';
  return null;
}

async function validateRasterImage(
  body: Buffer,
  declaredType: string | null,
): Promise<{ format: ValidatedImageFormat; contentType: string } | null> {
  try {
    const image = sharp(body, {
      failOn: 'error',
      limitInputPixels: IMAGE_UPSTREAM_MAX_PIXELS,
      sequentialRead: true,
    });
    const metadata = await image.metadata();
    const format = metadata.format;
    if (!format || !ACCEPTED_IMAGE_FORMATS.has(format as ValidatedImageFormat)) {
      return null;
    }
    const validatedFormat = format as ValidatedImageFormat;
    if (
      !Number.isSafeInteger(metadata.width)
      || !Number.isSafeInteger(metadata.height)
      || !metadata.width
      || !metadata.height
      || metadata.width * metadata.height > IMAGE_UPSTREAM_MAX_PIXELS
      || (metadata.pages ?? 1) !== 1
    ) {
      return null;
    }

    // A present upstream MIME type must agree with the decoded bytes. Missing
    // types are permitted because the response type is always derived below.
    if (declaredType && canonicalDeclaredFormat(declaredType) !== validatedFormat) {
      return null;
    }

    // metadata() reads image headers. stats() forces a full decode so truncated
    // or otherwise malformed raster data cannot be served from Helprr's origin.
    await sharp(body, {
      failOn: 'error',
      limitInputPixels: IMAGE_UPSTREAM_MAX_PIXELS,
      sequentialRead: true,
    }).stats();

    return {
      format: validatedFormat,
      contentType: CONTENT_TYPE_BY_FORMAT[validatedFormat],
    };
  } catch {
    return null;
  }
}

function failedUpstream(
  status: number,
  host: string,
  rejection: ValidatedUpstreamResult['rejection'] = null,
  validatedBytes = 0,
): ValidatedUpstreamResult {
  return {
    status,
    ok: false,
    body: null,
    contentType: null,
    format: null,
    validatedBytes,
    host,
    rejection,
  };
}

async function fetchUpstreamImage(
  url: string,
  headers?: HeadersInit,
  isRedirectTargetAllowed?: (target: URL) => boolean,
  timeoutMs = IMAGE_UPSTREAM_FETCH_TIMEOUT_MS,
): Promise<ValidatedUpstreamResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let currentUrl: URL;

  try {
    currentUrl = fragmentFreeUrl(url);
  } catch {
    clearTimeout(timeout);
    return failedUpstream(502, '');
  }

  try {
    let currentHeaders = headers;

    // Redirects are followed manually so every fragment-free hop is
    // re-validated against the caller's allowlist. A single controller keeps
    // the timeout authoritative across the complete redirect chain.
    for (let hop = 0; ; hop++) {
      const response = await fetch(currentUrl.toString(), {
        headers: currentHeaders,
        cache: 'no-store',
        signal: controller.signal,
        redirect: 'manual',
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || hop >= MAX_IMAGE_REDIRECTS) {
          await response.body?.cancel().catch(() => undefined);
          return failedUpstream(502, currentUrl.hostname);
        }

        let target: URL;
        try {
          target = fragmentFreeUrl(new URL(location, currentUrl));
        } catch {
          await response.body?.cancel().catch(() => undefined);
          return failedUpstream(502, currentUrl.hostname);
        }

        if (
          (target.protocol !== 'http:' && target.protocol !== 'https:')
          || !isRedirectTargetAllowed?.(target)
        ) {
          await response.body?.cancel().catch(() => undefined);
          return failedUpstream(502, target.hostname);
        }

        // Never leak the upstream's auth or custom credential headers to a
        // different origin.
        if (target.origin !== currentUrl.origin) currentHeaders = undefined;
        await response.body?.cancel().catch(() => undefined);
        currentUrl = target;
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return failedUpstream(response.status, currentUrl.hostname);
      }

      const bounded = await readBoundedResponseBody(response, controller);
      if (bounded.oversized) {
        return failedUpstream(413, currentUrl.hostname, 'oversized');
      }
      if (!bounded.body) {
        return failedUpstream(415, currentUrl.hostname, 'invalid-image');
      }

      const validated = await validateRasterImage(
        bounded.body,
        response.headers.get('content-type'),
      );
      if (!validated) {
        return failedUpstream(
          415,
          currentUrl.hostname,
          'invalid-image',
          bounded.body.byteLength,
        );
      }

      return {
        status: response.status,
        ok: true,
        body: bounded.body,
        contentType: validated.contentType,
        format: validated.format,
        validatedBytes: bounded.body.byteLength,
        host: currentUrl.hostname.toLowerCase().slice(0, 255),
        rejection: null,
      };
    }
  } catch (error) {
    return failedUpstream(isFetchAbortError(error) ? 504 : 502, currentUrl.hostname);
  } finally {
    clearTimeout(timeout);
  }
}

async function applyImageTransform(
  body: Buffer,
  format: ValidatedImageFormat,
  transform: ImageTransform | undefined,
): Promise<{ body: Buffer; contentType: string; format: ValidatedImageFormat }> {
  if (!transform) {
    return { body, contentType: CONTENT_TYPE_BY_FORMAT[format], format };
  }

  const pipeline = sharp(body, {
    failOn: 'error',
    limitInputPixels: IMAGE_UPSTREAM_MAX_PIXELS,
    sequentialRead: true,
  });
  if (transform.width) {
    pipeline.resize({ width: transform.width, withoutEnlargement: true });
  }
  const output = await pipeline.webp({ quality: WEBP_TRANSFORM_QUALITY }).toBuffer();
  return { body: output, contentType: 'image/webp', format: 'webp' };
}

async function bestEffortObservation(
  redis: ImageAccountingRedis | null,
  observation: Parameters<typeof recordImageObservation>[1],
): Promise<void> {
  if (!redis) return;
  await recordImageObservation(redis, observation).catch(() => undefined);
}

async function checkUpstreamRateLimit(
  redis: ImageAccountingRedis | null,
  requesterId: string | undefined,
  host: string,
  cacheStatus: ImageCacheStatus,
): Promise<FetchCachedImageResult | null> {
  if (!redis || !requesterId) return null;
  try {
    const rate = await enforceImageFetchRateLimit(redis, requesterId);
    if (rate.allowed) return null;
    await bestEffortObservation(redis, {
      outcome: 'rate-limited',
      validatedBytes: 0,
      format: null,
      cacheStatus,
      host,
      counter: 'rateLimited',
    });
    return {
      status: 429,
      body: null,
      contentType: null,
      cacheStatus,
      retryAfterSeconds: rate.retryAfterSeconds,
    };
  } catch {
    // The image is still byte/pixel bounded when Redis is unavailable. Rate
    // accounting fails open so an outage does not break every uncached poster.
    return null;
  }
}

async function imageProcessingLimitResult(
  redis: ImageAccountingRedis | null,
  host: string,
  cacheStatus: ImageCacheStatus,
): Promise<FetchCachedImageResult> {
  await bestEffortObservation(redis, {
    outcome: 'rate-limited',
    validatedBytes: 0,
    format: null,
    cacheStatus,
    host,
    counter: 'rateLimited',
  });
  return {
    status: 429,
    body: null,
    contentType: null,
    cacheStatus,
    retryAfterSeconds: 1,
  };
}

async function fetchValidatedBypass(
  options: FetchCachedImageOptions,
  redis: ImageAccountingRedis | null,
): Promise<FetchCachedImageResult> {
  const host = safeHost(options.upstreamUrl);
  const limited = await checkUpstreamRateLimit(
    redis,
    options.requesterId,
    host,
    'BYPASS',
  );
  if (limited) return limited;

  const processingLease = await acquireBoundedImageProcessingLease(
    redis,
    options.requesterId,
  );
  if (!processingLease) {
    return imageProcessingLimitResult(redis, host, 'BYPASS');
  }

  try {
    await bestEffortObservation(redis, {
      outcome: 'served',
      validatedBytes: 0,
      format: null,
      cacheStatus: 'BYPASS',
      host,
      counter: 'upstreamFetches',
    });
    const upstream = await fetchUpstreamImage(
      options.upstreamUrl,
      options.upstreamHeaders,
      options.isRedirectTargetAllowed,
      options.timeoutMs,
    );
    if (!upstream.ok || !upstream.body || !upstream.format) {
      await bestEffortObservation(redis, {
        outcome: upstream.rejection ?? 'upstream-error',
        validatedBytes: upstream.validatedBytes,
        format: null,
        cacheStatus: 'BYPASS',
        host: upstream.host || host,
        counter: upstream.rejection === 'oversized'
          ? 'oversizedRejections'
          : upstream.rejection === 'invalid-image'
            ? 'invalidImageRejections'
            : 'cacheBypasses',
      });
      return {
        status: upstream.status,
        body: null,
        contentType: null,
        cacheStatus: 'BYPASS',
      };
    }

    try {
      const transformed = await applyImageTransform(
        upstream.body,
        upstream.format,
        options.transform,
      );
      await bestEffortObservation(redis, {
        outcome: 'served',
        validatedBytes: upstream.validatedBytes,
        format: transformed.format,
        cacheStatus: 'BYPASS',
        host: upstream.host,
        counter: 'cacheBypasses',
      });
      return {
        status: upstream.status,
        body: transformed.body,
        contentType: transformed.contentType,
        cacheStatus: 'BYPASS',
      };
    } catch {
      return {
        status: 502,
        body: null,
        contentType: null,
        cacheStatus: 'BYPASS',
      };
    }
  } finally {
    await releaseBoundedImageProcessingLease(redis, processingLease);
  }
}

async function strictRedisOrNull(): Promise<ImageAccountingRedis | null> {
  try {
    const redis = await getRedisClient();
    // The narrower interface keeps this module testable without exposing the
    // complete node-redis client surface.
    return redis as unknown as ImageAccountingRedis;
  } catch {
    return null;
  }
}

async function staleResult(
  meta: ImageCacheMeta | null,
  nowMs: number,
  redis?: ImageAccountingRedis,
  generation?: number,
  entryKey?: string,
): Promise<FetchCachedImageResult | null> {
  if (!meta || nowMs >= meta.staleUntil) return null;
  const body = await loadCachedImage(meta);
  if (!body) return null;
  if (redis && generation && entryKey) {
    await touchImageCacheEntry(
      redis,
      generation,
      entryKey,
      meta.relativePath,
      nowMs,
    ).catch(() => undefined);
  }
  return {
    status: 200,
    body,
    contentType: meta.contentType,
    cacheStatus: 'STALE',
  };
}

export async function fetchImageWithServerCache(
  options: FetchCachedImageOptions,
): Promise<FetchCachedImageResult> {
  let upstreamUrl: string;
  try {
    upstreamUrl = fragmentFreeUrl(options.upstreamUrl).toString();
  } catch {
    return {
      status: 502,
      body: null,
      contentType: null,
      cacheStatus: 'BYPASS',
    };
  }
  const normalizedOptions = { ...options, upstreamUrl };
  const enabled = await getCacheImagesEnabled();
  const redis = await strictRedisOrNull();

  if (!enabled || !redis) {
    // Redis is authoritative for cache accounting. A missing connection serves
    // a fully validated bounded image without creating any cache file.
    return fetchValidatedBypass(normalizedOptions, redis);
  }

  let generation: number;
  try {
    generation = await getStrictCacheGeneration(redis);
  } catch {
    return fetchValidatedBypass(normalizedOptions, null);
  }

  const cacheKey = normalizedOptions.cacheKey;
  const keyHash = sha256Hex(cacheKey);
  const metaKey = buildImageMetaKey(generation, cacheKey);
  const ttlSeconds = normalizedOptions.ttlSeconds ?? IMAGE_CACHE_TTL_SECONDS;
  const staleSeconds = normalizedOptions.staleSeconds ?? IMAGE_CACHE_STALE_SECONDS;
  const requestStartedAt = Date.now();
  let cachedMeta: ImageCacheMeta | null;

  try {
    cachedMeta = await readImageMeta(redis, metaKey, generation);
  } catch {
    return fetchValidatedBypass(normalizedOptions, null);
  }

  if (cachedMeta && requestStartedAt < cachedMeta.expiresAt) {
    const cachedBody = await loadCachedImage(cachedMeta);
    if (cachedBody) {
      await Promise.all([
        touchImageCacheEntry(
          redis,
          generation,
          metaKey,
          cachedMeta.relativePath,
          requestStartedAt,
        ).catch(() => undefined),
        bestEffortObservation(redis, {
          outcome: 'served',
          validatedBytes: cachedMeta.sizeBytes,
          format: cachedMeta.format,
          cacheStatus: 'HIT',
          host: safeHost(upstreamUrl),
          counter: 'cacheHits',
        }),
      ]);
      return {
        status: 200,
        body: cachedBody,
        contentType: cachedMeta.contentType,
        cacheStatus: 'HIT',
      };
    }
    await removeImageCacheEntry(
      redis,
      generation,
      metaKey,
      cachedMeta.relativePath,
    ).catch(() => undefined);
    cachedMeta = null;
  }

  let fillLockToken: string | null;
  try {
    fillLockToken = await acquireImageFillLock(redis, generation, keyHash);
  } catch {
    return fetchValidatedBypass(normalizedOptions, null);
  }

  if (!fillLockToken) {
    const stale = await staleResult(
      cachedMeta,
      requestStartedAt,
      redis,
      generation,
      metaKey,
    );
    if (stale) return stale;
    // Another request owns this key's fill. Fetching remains available, but
    // this request deliberately bypasses storage so duplicate fills cannot
    // race metadata replacement.
    return fetchValidatedBypass(normalizedOptions, redis);
  }

  try {
    const limited = await checkUpstreamRateLimit(
      redis,
      normalizedOptions.requesterId,
      safeHost(upstreamUrl),
      cachedMeta ? 'REVALIDATED' : 'MISS',
    );
    if (limited) {
      return (await staleResult(
        cachedMeta,
        requestStartedAt,
        redis,
        generation,
        metaKey,
      )) ?? limited;
    }

    const processingCacheStatus: ImageCacheStatus = cachedMeta ? 'REVALIDATED' : 'MISS';
    const processingLease = await acquireBoundedImageProcessingLease(
      redis,
      normalizedOptions.requesterId,
    );
    if (!processingLease) {
      return (await staleResult(
        cachedMeta,
        requestStartedAt,
        redis,
        generation,
        metaKey,
      )) ?? imageProcessingLimitResult(
        redis,
        safeHost(upstreamUrl),
        processingCacheStatus,
      );
    }

    let upstream: Awaited<ReturnType<typeof fetchUpstreamImage>>;
    let transformed: Awaited<ReturnType<typeof applyImageTransform>>;
    try {
      await bestEffortObservation(redis, {
        outcome: 'served',
        validatedBytes: 0,
        format: null,
        cacheStatus: processingCacheStatus,
        host: safeHost(upstreamUrl),
        counter: 'upstreamFetches',
      });
      upstream = await fetchUpstreamImage(
        upstreamUrl,
        normalizedOptions.upstreamHeaders,
        normalizedOptions.isRedirectTargetAllowed,
        normalizedOptions.timeoutMs,
      );
      if (!upstream.ok || !upstream.body || !upstream.format) {
        await bestEffortObservation(redis, {
          outcome: upstream.rejection ?? 'upstream-error',
          validatedBytes: upstream.validatedBytes,
          format: null,
          cacheStatus: processingCacheStatus,
          host: upstream.host || safeHost(upstreamUrl),
          counter: upstream.rejection === 'oversized'
            ? 'oversizedRejections'
            : upstream.rejection === 'invalid-image'
              ? 'invalidImageRejections'
              : undefined,
        });
        const stale = supportsStaleForStatus(upstream.status)
          ? await staleResult(cachedMeta, requestStartedAt, redis, generation, metaKey)
          : null;
        if (stale) return stale;
        return {
          status: upstream.status,
          body: null,
          contentType: null,
          cacheStatus: processingCacheStatus,
        };
      }

      try {
        transformed = await applyImageTransform(
          upstream.body,
          upstream.format,
          normalizedOptions.transform,
        );
      } catch {
        return {
          status: 502,
          body: null,
          contentType: null,
          cacheStatus: processingCacheStatus,
        };
      }
    } finally {
      await releaseBoundedImageProcessingLease(redis, processingLease);
    }

    const cacheStatus = processingCacheStatus;
    if (transformed.body.byteLength > IMAGE_CACHE_MAX_BYTES) {
      await bestEffortObservation(redis, {
        outcome: 'served',
        validatedBytes: upstream.validatedBytes,
        format: transformed.format,
        cacheStatus: 'BYPASS',
        host: upstream.host,
        counter: 'cacheBypasses',
      });
      return {
        status: 200,
        body: transformed.body,
        contentType: transformed.contentType,
        cacheStatus: 'BYPASS',
      };
    }

    let quotaLockToken: string | null;
    try {
      quotaLockToken = await acquireImageQuotaLock(redis, generation);
    } catch {
      quotaLockToken = null;
    }
    if (!quotaLockToken) {
      await bestEffortObservation(redis, {
        outcome: 'served',
        validatedBytes: upstream.validatedBytes,
        format: transformed.format,
        cacheStatus: 'BYPASS',
        host: upstream.host,
        counter: 'cacheBypasses',
      });
      return {
        status: 200,
        body: transformed.body,
        contentType: transformed.contentType,
        cacheStatus: 'BYPASS',
      };
    }

    let relativePath: string | null = null;
    let mutation: Awaited<ReturnType<typeof registerImageCacheEntry>> | null = null;
    try {
      relativePath = await saveCachedImage(generation, keyHash, transformed.body);
      const storedAt = Date.now();
      const meta: ImageCacheMeta = {
        generation,
        relativePath,
        contentType: transformed.contentType,
        format: transformed.format,
        sizeBytes: transformed.body.byteLength,
        fetchedAt: storedAt,
        expiresAt: storedAt + ttlSeconds * 1000,
        staleUntil: storedAt + (ttlSeconds + staleSeconds) * 1000,
      };
      const indexEntry: ImageIndexEntry = {
        entryKey: metaKey,
        relativePath,
        sizeBytes: transformed.body.byteLength,
        lastUsedAt: storedAt,
      };
      mutation = await registerImageCacheEntry(
        redis,
        generation,
        indexEntry,
        JSON.stringify(meta),
        Math.max(1, Math.ceil((meta.staleUntil - storedAt) / 1000)),
        quotaLockToken,
      );
    } catch {
      if (relativePath) await unlinkRelativePath(relativePath);
    } finally {
      await releaseImageQuotaLock(redis, generation, quotaLockToken).catch(() => undefined);
    }

    if (!mutation) {
      return {
        status: 200,
        body: transformed.body,
        contentType: transformed.contentType,
        cacheStatus: 'BYPASS',
      };
    }

    // Redis metadata/index removal happens atomically before immutable files
    // are deleted. A failed unlink therefore becomes bounded orphan-retention
    // work and never restores an evicted entry.
    const obsoletePaths = new Set<string>();
    const currentWasEvicted = mutation.evicted.some(
      (entry) => entry.entryKey === metaKey && entry.relativePath === relativePath,
    );
    if (mutation.previous?.relativePath !== relativePath) {
      if (mutation.previous) obsoletePaths.add(mutation.previous.relativePath);
    }
    if (cachedMeta?.relativePath !== relativePath) {
      if (cachedMeta) obsoletePaths.add(cachedMeta.relativePath);
    }
    for (const entry of mutation.evicted) {
      obsoletePaths.add(entry.relativePath);
    }
    await Promise.all([...obsoletePaths].map((entryPath) => unlinkRelativePath(entryPath)));

    const finalCacheStatus: ImageCacheStatus = currentWasEvicted ? 'BYPASS' : cacheStatus;
    await bestEffortObservation(redis, {
      outcome: 'served',
      validatedBytes: upstream.validatedBytes,
      format: transformed.format,
      cacheStatus: finalCacheStatus,
      host: upstream.host,
      counter: currentWasEvicted ? 'cacheBypasses' : undefined,
    });
    return {
      status: 200,
      body: transformed.body,
      contentType: transformed.contentType,
      cacheStatus: finalCacheStatus,
    };
  } catch {
    const stale = await staleResult(cachedMeta, requestStartedAt, redis, generation, metaKey);
    if (stale) return stale;
    return {
      status: 502,
      body: null,
      contentType: null,
      cacheStatus: cachedMeta ? 'REVALIDATED' : 'MISS',
    };
  } finally {
    await releaseImageFillLock(redis, generation, keyHash, fillLockToken).catch(() => undefined);
  }
}

export async function deleteCachedImageFile(meta: ImageCacheMeta): Promise<void> {
  await unlinkRelativePath(meta.relativePath);
}
