import { createHash, randomUUID } from 'crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import {
  acquireImageFillLock,
  acquireImageQuotaLock,
  enforceImageFetchRateLimit,
  type ImageAccountingRedis,
  type ImageIndexEntry,
  recordImageObservation,
  recordImageQueueWait,
  registerImageCacheEntry,
  releaseImageFillLock,
  releaseImageQuotaLock,
  removeImageCacheEntry,
  renewImageFillLock,
  touchImageCacheEntry,
} from '@/lib/cache/image-cache-accounting';
import {
  IMAGE_CACHE_DIR,
  IMAGE_CACHE_MAX_BYTES,
  IMAGE_CACHE_STALE_SECONDS,
  IMAGE_CACHE_TTL_SECONDS,
  IMAGE_PROCESSING_QUEUE_WAIT_MS,
  IMAGE_QUOTA_LOCK_WAIT_MS,
  IMAGE_UPSTREAM_FETCH_TIMEOUT_MS,
  IMAGE_UPSTREAM_MAX_BYTES,
  IMAGE_UPSTREAM_MAX_PIXELS,
  CACHE_LOCK_TTL_MS,
} from '@/lib/cache/config';
import { buildImageMetaKey, sha256Hex } from '@/lib/cache/keys';
import { getCacheImagesEnabled } from '@/lib/cache/state';
import { getRedisClient } from '@/lib/redis';
import {
  acquireScheduledImageProcessingLease,
  beginImageProcessingShutdown,
  getImageProcessingSnapshot,
  type ImageQueueAcquireResult,
  releaseScheduledImageProcessingLease,
} from '@/lib/cache/image-processing-scheduler';

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
  signal?: AbortSignal;
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
  timings?: {
    queueMs: number;
    upstreamMs: number;
  };
}

export interface ImageCacheMeta {
  generation: number;
  relativePath: string;
  contentType: string;
  format: ValidatedImageFormat;
  sizeBytes: number;
  contentHash?: string;
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

function sha256BufferHex(input: Buffer): string {
  return createHash('sha256').update(input).digest('hex');
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

function upstreamFetchCandidates(
  upstreamUrl: string,
  transform: ImageTransform | undefined,
): string[] {
  if (!transform?.width) return [upstreamUrl];
  let parsed: URL;
  try {
    parsed = fragmentFreeUrl(upstreamUrl);
  } catch {
    return [upstreamUrl];
  }
  if (parsed.hostname.toLowerCase() !== 'image.tmdb.org') return [upstreamUrl];

  const match = /^\/t\/p\/(original|w[0-9]+)(\/.*)$/i.exec(parsed.pathname);
  if (!match) return [upstreamUrl];
  const widths = [92, 154, 185, 342, 500, 780, 1_280];
  const target = widths.find((width) => width >= transform.width!);
  if (!target) return [upstreamUrl];
  const current = match[1]!.toLowerCase() === 'original'
    ? Number.POSITIVE_INFINITY
    : Number.parseInt(match[1]!.slice(1), 10);
  if (Number.isFinite(current) && current <= target) return [upstreamUrl];

  const sized = new URL(parsed);
  sized.pathname = `/t/p/w${target}${match[2]}`;
  const sizedUrl = sized.toString();
  return sizedUrl === upstreamUrl ? [upstreamUrl] : [sizedUrl, upstreamUrl];
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
      || (parsed.contentHash !== undefined
        && (typeof parsed.contentHash !== 'string' || !/^[0-9a-f]{64}$/i.test(parsed.contentHash)))
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
      contentHash: parsed.contentHash,
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
    if (body.byteLength !== meta.sizeBytes) return null;
    if (meta.contentHash && sha256BufferHex(body) !== meta.contentHash) return null;
    return body;
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
  requireFullDecode: boolean,
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

    if (requireFullDecode) {
      // metadata() reads image headers. Pass-through responses need this full
      // decode before their bytes can be served from Helprr's origin. A route
      // that immediately resizes/re-encodes skips it because that transform is
      // itself the authoritative full decode.
      await sharp(body, {
        failOn: 'error',
        limitInputPixels: IMAGE_UPSTREAM_MAX_PIXELS,
        sequentialRead: true,
      }).stats();
    }

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
  options: { signal?: AbortSignal; requireFullDecode: boolean } = {
    requireFullDecode: true,
  },
): Promise<ValidatedUpstreamResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromRequest = () => controller.abort();
  options.signal?.addEventListener('abort', abortFromRequest, { once: true });
  let currentUrl: URL;

  try {
    currentUrl = fragmentFreeUrl(url);
  } catch {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortFromRequest);
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
        options.requireFullDecode,
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
    const aborted = isFetchAbortError(error);
    return failedUpstream(
      aborted ? (timedOut ? 504 : 499) : 502,
      currentUrl.hostname,
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortFromRequest);
  }
}

async function applyImageTransform(
  body: Buffer,
  format: ValidatedImageFormat,
  transform: ImageTransform | undefined,
  signal?: AbortSignal,
): Promise<{ body: Buffer; contentType: string; format: ValidatedImageFormat }> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
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
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
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
      counter: 'rateLimitRejections',
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

async function queueFailureResult(
  redis: ImageAccountingRedis | null,
  host: string,
  cacheStatus: ImageCacheStatus,
  acquired: Extract<ImageQueueAcquireResult, { ok: false }>,
): Promise<FetchCachedImageResult> {
  if (redis) {
    await recordImageQueueWait(redis, acquired.queueWaitMs).catch(() => undefined);
  }
  const aborted = acquired.reason === 'aborted' || acquired.reason === 'shutdown';
  await bestEffortObservation(redis, {
    outcome: aborted ? 'client-abort' : 'queue-capacity',
    validatedBytes: 0,
    format: null,
    cacheStatus,
    host,
    counter: aborted ? 'clientAborts' : 'queueCapacityRejections',
  });
  return {
    status: aborted ? 499 : 503,
    body: null,
    contentType: null,
    cacheStatus,
    retryAfterSeconds: aborted ? undefined : 1,
    timings: { queueMs: acquired.queueWaitMs, upstreamMs: 0 },
  };
}

async function acquireProcessing(
  redis: ImageAccountingRedis | null,
  options: FetchCachedImageOptions,
  cacheStatus: ImageCacheStatus,
  priority: 'visible' | 'background',
  waitMs = IMAGE_PROCESSING_QUEUE_WAIT_MS,
): Promise<
  | { ok: true; lease: Extract<ImageQueueAcquireResult, { ok: true }>['lease'] }
  | { ok: false; response: FetchCachedImageResult }
> {
  const acquired = await acquireScheduledImageProcessingLease(
    redis,
    options.requesterId,
    { waitMs, priority, signal: options.signal },
  );
  if (!acquired.ok) {
    return {
      ok: false,
      response: await queueFailureResult(
        redis,
        safeHost(options.upstreamUrl),
        cacheStatus,
        acquired,
      ),
    };
  }
  if (redis) {
    await recordImageQueueWait(redis, acquired.lease.queueWaitMs).catch(() => undefined);
  }
  return { ok: true, lease: acquired.lease };
}

interface SuccessfulTransform {
  upstream: ValidatedUpstreamResult;
  transformed: Awaited<ReturnType<typeof applyImageTransform>>;
  upstreamMs: number;
}

async function fetchAndTransform(
  options: FetchCachedImageOptions,
  redis: ImageAccountingRedis | null,
  cacheStatus: ImageCacheStatus,
): Promise<SuccessfulTransform | FetchCachedImageResult> {
  const candidates = upstreamFetchCandidates(options.upstreamUrl, options.transform);
  let lastFailure: FetchCachedImageResult | null = null;
  let upstreamMs = 0;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    const host = safeHost(candidate);
    const limited = await checkUpstreamRateLimit(
      redis,
      options.requesterId,
      host,
      cacheStatus,
    );
    if (limited) return limited;

    await bestEffortObservation(redis, {
      outcome: 'served',
      validatedBytes: 0,
      format: null,
      cacheStatus,
      host,
      counter: 'upstreamFetches',
    });
    const upstreamStartedAt = Date.now();
    const upstream = await fetchUpstreamImage(
      candidate,
      options.upstreamHeaders,
      options.isRedirectTargetAllowed,
      options.timeoutMs,
      {
        signal: options.signal,
        requireFullDecode: !options.transform,
      },
    );
    upstreamMs += Math.max(0, Date.now() - upstreamStartedAt);
    if (!upstream.ok || !upstream.body || !upstream.format) {
      const counter = upstream.rejection === 'oversized'
        ? 'oversizedRejections'
        : upstream.rejection === 'invalid-image'
          ? 'invalidImageRejections'
          : upstream.status === 499
            ? 'clientAborts'
            : upstream.status === 504
              ? 'upstreamTimeouts'
              : 'upstreamErrors';
      await bestEffortObservation(redis, {
        outcome: upstream.rejection
          ?? (upstream.status === 499
            ? 'client-abort'
            : upstream.status === 504
              ? 'upstream-timeout'
              : 'upstream-error'),
        validatedBytes: upstream.validatedBytes,
        format: null,
        cacheStatus,
        host: upstream.host || host,
        counter,
      });
      lastFailure = {
        status: upstream.status,
        body: null,
        contentType: null,
        cacheStatus,
        timings: { queueMs: 0, upstreamMs },
      };

      // TMDB sized variants are an optimization, not a new source of truth.
      // Fall back only for a missing or invalid variant; outages/timeouts and
      // client cancellation should not trigger a second upstream request.
      const mayFallback = index < candidates.length - 1
        && (upstream.status === 404 || upstream.status === 413 || upstream.status === 415);
      if (mayFallback) continue;
      return lastFailure;
    }

    try {
      const transformed = await applyImageTransform(
        upstream.body,
        upstream.format,
        options.transform,
        options.signal,
      );
      return { upstream, transformed, upstreamMs };
    } catch (error) {
      const aborted = isFetchAbortError(error) || options.signal?.aborted;
      await bestEffortObservation(redis, {
        outcome: aborted ? 'client-abort' : 'invalid-image',
        validatedBytes: upstream.validatedBytes,
        format: null,
        cacheStatus,
        host: upstream.host,
        counter: aborted ? 'clientAborts' : 'invalidImageRejections',
      });
      const failure: FetchCachedImageResult = {
        status: aborted ? 499 : 502,
        body: null,
        contentType: null,
        cacheStatus,
        timings: { queueMs: 0, upstreamMs },
      };
      if (!aborted && index < candidates.length - 1) {
        lastFailure = failure;
        continue;
      }
      return failure;
    }
  }

  return lastFailure ?? {
    status: 502,
    body: null,
    contentType: null,
    cacheStatus,
    timings: { queueMs: 0, upstreamMs },
  };
}

async function fetchValidatedBypass(
  options: FetchCachedImageOptions,
  redis: ImageAccountingRedis | null,
): Promise<FetchCachedImageResult> {
  const host = safeHost(options.upstreamUrl);
  const acquired = await acquireProcessing(redis, options, 'BYPASS', 'visible');
  if (!acquired.ok) return acquired.response;

  try {
    const fetched = await fetchAndTransform(options, redis, 'BYPASS');
    if ('status' in fetched) {
      return {
        ...fetched,
        timings: {
          queueMs: acquired.lease.queueWaitMs,
          upstreamMs: fetched.timings?.upstreamMs ?? 0,
        },
      };
    }
    await bestEffortObservation(redis, {
      outcome: 'served',
      validatedBytes: fetched.upstream.validatedBytes,
      format: fetched.transformed.format,
      cacheStatus: 'BYPASS',
      host: fetched.upstream.host || host,
      counter: 'cacheBypasses',
    });
    return {
      status: 200,
      body: fetched.transformed.body,
      contentType: fetched.transformed.contentType,
      cacheStatus: 'BYPASS',
      timings: {
        queueMs: acquired.lease.queueWaitMs,
        upstreamMs: fetched.upstreamMs,
      },
    };
  } finally {
    await releaseScheduledImageProcessingLease(redis, acquired.lease);
  }
}

async function strictRedisOrNull(): Promise<ImageAccountingRedis | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const redis = await Promise.race([
      getRedisClient(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Redis connection timed out')), 500);
      }),
    ]);
    // The narrower interface keeps this module testable without exposing the
    // complete node-redis client surface.
    return redis as unknown as ImageAccountingRedis;
  } catch {
    return null;
  } finally {
    if (timeout) clearTimeout(timeout);
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

async function sleepWithSignal(delayMs: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return false;
  return new Promise<boolean>((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, delayMs);
    timer.unref?.();
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function waitForQuotaLock(
  redis: ImageAccountingRedis,
  generation: number,
  signal?: AbortSignal,
): Promise<{ token: string | null; waitedMs: number }> {
  const startedAt = Date.now();
  const deadline = startedAt + IMAGE_QUOTA_LOCK_WAIT_MS;
  let observedContention = false;
  do {
    if (signal?.aborted) return { token: null, waitedMs: Date.now() - startedAt };
    let token: string | null = null;
    try {
      token = await acquireImageQuotaLock(redis, generation);
    } catch {
      return { token: null, waitedMs: Date.now() - startedAt };
    }
    if (token) {
      if (observedContention) {
        await bestEffortObservation(redis, {
          outcome: 'served',
          validatedBytes: 0,
          format: null,
          cacheStatus: 'MISS',
          host: '',
          counter: 'quotaLockWaits',
        });
      }
      return { token, waitedMs: Date.now() - startedAt };
    }
    observedContention = true;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const continued = await sleepWithSignal(
      Math.min(remaining, 40 + Math.round(Math.random() * 60)),
      signal,
    );
    if (!continued) break;
  } while (Date.now() < deadline);

  await bestEffortObservation(redis, {
    outcome: 'quota-lock-timeout',
    validatedBytes: 0,
    format: null,
    cacheStatus: 'BYPASS',
    host: '',
    counter: 'quotaLockTimeouts',
  });
  return { token: null, waitedMs: Date.now() - startedAt };
}

async function recoverMissingCacheFile(
  redis: ImageAccountingRedis,
  generation: number,
  metaKey: string,
  meta: ImageCacheMeta,
  host: string,
): Promise<void> {
  await Promise.all([
    removeImageCacheEntry(redis, generation, metaKey, meta.relativePath)
      .catch(() => undefined),
    unlinkRelativePath(meta.relativePath),
    bestEffortObservation(redis, {
      outcome: 'missing-file',
      validatedBytes: 0,
      format: meta.format,
      cacheStatus: 'MISS',
      host,
      counter: 'missingFileRecoveries',
    }),
  ]);
}

async function resultFromCurrentMetadata(
  redis: ImageAccountingRedis,
  generation: number,
  metaKey: string,
  nowMs: number,
  host: string,
): Promise<FetchCachedImageResult | null> {
  const meta = await readImageMeta(redis, metaKey, generation).catch(() => null);
  if (!meta) return null;
  const body = await loadCachedImage(meta);
  if (!body) {
    await recoverMissingCacheFile(redis, generation, metaKey, meta, host);
    return null;
  }
  await Promise.all([
    touchImageCacheEntry(redis, generation, metaKey, meta.relativePath, nowMs)
      .catch(() => undefined),
    bestEffortObservation(redis, {
      outcome: 'served',
      validatedBytes: meta.sizeBytes,
      format: meta.format,
      cacheStatus: 'HIT',
      host,
      counter: 'cacheHits',
    }),
  ]);
  return {
    status: 200,
    body,
    contentType: meta.contentType,
    cacheStatus: 'HIT',
  };
}

async function storeTransformedImage(
  redis: ImageAccountingRedis,
  generation: number,
  keyHash: string,
  metaKey: string,
  cachedMeta: ImageCacheMeta | null,
  fetched: SuccessfulTransform,
  cacheStatus: ImageCacheStatus,
  ttlSeconds: number,
  staleSeconds: number,
  signal?: AbortSignal,
): Promise<FetchCachedImageResult> {
  const { upstream, transformed } = fetched;
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

  let relativePath: string | null = null;
  let mutation: Awaited<ReturnType<typeof registerImageCacheEntry>> | null = null;
  try {
    // The expensive write is outside the quota lock. The lock now protects only
    // the short Redis accounting/commit transaction.
    relativePath = await saveCachedImage(generation, keyHash, transformed.body);
    const lock = await waitForQuotaLock(redis, generation, signal);
    if (!lock.token) throw new Error('Image quota lock unavailable');
    try {
      const storedAt = Date.now();
      const meta: ImageCacheMeta = {
        generation,
        relativePath,
        contentType: transformed.contentType,
        format: transformed.format,
        sizeBytes: transformed.body.byteLength,
        contentHash: sha256BufferHex(transformed.body),
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
        lock.token,
      );
    } finally {
      await releaseImageQuotaLock(redis, generation, lock.token).catch(() => undefined);
    }
  } catch {
    if (relativePath) await unlinkRelativePath(relativePath);
  }

  if (!mutation || !relativePath) {
    await bestEffortObservation(redis, {
      outcome: 'served',
      validatedBytes: upstream.validatedBytes,
      format: transformed.format,
      cacheStatus: 'BYPASS',
      host: upstream.host,
      counter: 'healthyBypasses',
    });
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

  const obsoletePaths = new Set<string>();
  const currentWasEvicted = mutation.evicted.some(
    (entry) => entry.entryKey === metaKey && entry.relativePath === relativePath,
  );
  if (mutation.previous && mutation.previous.relativePath !== relativePath) {
    obsoletePaths.add(mutation.previous.relativePath);
  }
  if (cachedMeta && cachedMeta.relativePath !== relativePath) {
    obsoletePaths.add(cachedMeta.relativePath);
  }
  for (const entry of mutation.evicted) obsoletePaths.add(entry.relativePath);
  await Promise.all([...obsoletePaths].map((entryPath) => unlinkRelativePath(entryPath)));

  const finalCacheStatus: ImageCacheStatus = currentWasEvicted ? 'BYPASS' : cacheStatus;
  await bestEffortObservation(redis, {
    outcome: 'served',
    validatedBytes: upstream.validatedBytes,
    format: transformed.format,
    cacheStatus: finalCacheStatus,
    host: upstream.host,
    counter: currentWasEvicted ? 'cacheBypasses' : 'registrations',
  });
  return {
    status: 200,
    body: transformed.body,
    contentType: transformed.contentType,
    cacheStatus: finalCacheStatus,
  };
}

async function performCachedFill(
  options: FetchCachedImageOptions,
  redis: ImageAccountingRedis,
  generation: number,
  keyHash: string,
  metaKey: string,
  cachedMeta: ImageCacheMeta | null,
  ttlSeconds: number,
  staleSeconds: number,
  priority: 'visible' | 'background',
): Promise<FetchCachedImageResult> {
  const cacheStatus: ImageCacheStatus = cachedMeta ? 'REVALIDATED' : 'MISS';
  const host = safeHost(options.upstreamUrl);
  const queueDeadline = Date.now() + IMAGE_PROCESSING_QUEUE_WAIT_MS;
  let fillLockToken: string | null = null;
  let fillLockRenewal: ReturnType<typeof setInterval> | null = null;

  try {
    do {
      if (options.signal?.aborted) {
        return {
          status: 499,
          body: null,
          contentType: null,
          cacheStatus,
        };
      }
      try {
        fillLockToken = await acquireImageFillLock(redis, generation, keyHash);
      } catch {
        return fetchValidatedBypass(options, null);
      }
      if (fillLockToken) break;

      const latest = await readImageMeta(redis, metaKey, generation).catch(() => null);
      if (
        latest
        && (!cachedMeta
          || latest.relativePath !== cachedMeta.relativePath
          || latest.expiresAt > cachedMeta.expiresAt)
      ) {
        const completed = await resultFromCurrentMetadata(
          redis,
          generation,
          metaKey,
          Date.now(),
          host,
        );
        if (completed) return completed;
      }
      const remaining = queueDeadline - Date.now();
      if (remaining <= 0) {
        const failed: Extract<ImageQueueAcquireResult, { ok: false }> = {
          ok: false,
          reason: 'timeout',
          queueWaitMs: IMAGE_PROCESSING_QUEUE_WAIT_MS,
        };
        return queueFailureResult(redis, host, cacheStatus, failed);
      }
      if (!(await sleepWithSignal(
        Math.min(remaining, 100 + Math.round(Math.random() * 150)),
        options.signal,
      ))) {
        return {
          status: 499,
          body: null,
          contentType: null,
          cacheStatus,
        };
      }
    } while (!fillLockToken);

    // The fill lock is acquired before local admission so other replicas can
    // wait for this key instead of queueing duplicate upstream work. Renew it
    // while this owner is queued or processing; a crashed owner still expires
    // after the configured short lease.
    fillLockRenewal = setInterval(() => {
      if (!fillLockToken) return;
      void renewImageFillLock(redis, generation, keyHash, fillLockToken)
        .catch(() => undefined);
    }, Math.max(1, Math.floor(CACHE_LOCK_TTL_MS / 2)));
    fillLockRenewal.unref?.();

    // The lock may have become available just after another replica committed.
    // Recheck before consuming queue or rate capacity.
    const latest = await readImageMeta(redis, metaKey, generation).catch(() => null);
    if (
      latest
      && (!cachedMeta
        || latest.relativePath !== cachedMeta.relativePath
        || latest.expiresAt > cachedMeta.expiresAt)
    ) {
      const completed = await resultFromCurrentMetadata(
        redis,
        generation,
        metaKey,
        Date.now(),
        host,
      );
      if (completed) return completed;
    }

    const remainingQueueMs = Math.max(1, queueDeadline - Date.now());
    const acquired = await acquireProcessing(
      redis,
      options,
      cacheStatus,
      priority,
      remainingQueueMs,
    );
    if (!acquired.ok) return acquired.response;

    let fetched: SuccessfulTransform | FetchCachedImageResult;
    try {
      fetched = await fetchAndTransform(options, redis, cacheStatus);
    } finally {
      await releaseScheduledImageProcessingLease(redis, acquired.lease);
    }
    if ('status' in fetched) {
      return {
        ...fetched,
        timings: {
          queueMs: acquired.lease.queueWaitMs,
          upstreamMs: fetched.timings?.upstreamMs ?? 0,
        },
      };
    }
    const stored = await storeTransformedImage(
      redis,
      generation,
      keyHash,
      metaKey,
      cachedMeta,
      fetched,
      cacheStatus,
      ttlSeconds,
      staleSeconds,
      options.signal,
    );
    return {
      ...stored,
      timings: {
        queueMs: acquired.lease.queueWaitMs,
        upstreamMs: fetched.upstreamMs,
      },
    };
  } catch {
    return {
      status: options.signal?.aborted ? 499 : 502,
      body: null,
      contentType: null,
      cacheStatus,
    };
  } finally {
    if (fillLockRenewal) clearInterval(fillLockRenewal);
    if (fillLockToken) {
      await releaseImageFillLock(redis, generation, keyHash, fillLockToken)
        .catch(() => undefined);
    }
  }
}

interface InFlightImageWork {
  promise: Promise<FetchCachedImageResult>;
  controller: AbortController;
  consumers: number;
  settled: boolean;
  background: boolean;
}

const IMAGE_INFLIGHT_STATE_KEY = '__helprrImageInflightState' as const;
const imageInflightGlobal = globalThis as typeof globalThis & {
  [IMAGE_INFLIGHT_STATE_KEY]?: {
    work: Map<string, InFlightImageWork>;
    backgroundTasks: Set<Promise<unknown>>;
    shuttingDown: boolean;
  };
};
const imageInflightState = (imageInflightGlobal[IMAGE_INFLIGHT_STATE_KEY] ??= {
  work: new Map<string, InFlightImageWork>(),
  backgroundTasks: new Set<Promise<unknown>>(),
  shuttingDown: false,
});

function getOrCreateInflightWork(
  key: string,
  background: boolean,
  factory: (signal: AbortSignal) => Promise<FetchCachedImageResult>,
): InFlightImageWork {
  const existing = imageInflightState.work.get(key);
  if (existing) return existing;
  const controller = new AbortController();
  const entry: InFlightImageWork = {
    controller,
    consumers: 0,
    settled: false,
    background,
    promise: Promise.resolve({
      status: 503,
      body: null,
      contentType: null,
      cacheStatus: 'MISS',
    }),
  };
  entry.promise = factory(controller.signal).finally(() => {
    entry.settled = true;
    if (imageInflightState.work.get(key) === entry) imageInflightState.work.delete(key);
  });
  imageInflightState.work.set(key, entry);
  return entry;
}

async function consumeInflightWork(
  entry: InFlightImageWork,
  signal: AbortSignal | undefined,
  cacheStatus: ImageCacheStatus,
): Promise<FetchCachedImageResult> {
  entry.consumers += 1;
  let abortListener: (() => void) | null = null;
  try {
    if (!signal) return await entry.promise;
    if (signal.aborted) {
      return { status: 499, body: null, contentType: null, cacheStatus };
    }
    return await Promise.race([
      entry.promise,
      new Promise<FetchCachedImageResult>((resolve) => {
        abortListener = () => resolve({
          status: 499,
          body: null,
          contentType: null,
          cacheStatus,
        });
        signal.addEventListener('abort', abortListener, { once: true });
      }),
    ]);
  } finally {
    if (abortListener) signal?.removeEventListener('abort', abortListener);
    entry.consumers = Math.max(0, entry.consumers - 1);
    if (entry.consumers === 0 && !entry.settled && !entry.background) {
      entry.controller.abort();
    }
  }
}

function scheduleBackgroundRevalidation(
  key: string,
  redis: ImageAccountingRedis,
  host: string,
  factory: (signal: AbortSignal) => Promise<FetchCachedImageResult>,
): void {
  if (imageInflightState.shuttingDown || imageInflightState.work.has(key)) return;
  void bestEffortObservation(redis, {
    outcome: 'background-revalidation',
    validatedBytes: 0,
    format: null,
    cacheStatus: 'REVALIDATED',
    host,
    counter: 'backgroundRevalidationsStarted',
  });
  const entry = getOrCreateInflightWork(key, true, factory);
  const task = entry.promise
    .then((result) => bestEffortObservation(redis, {
      outcome: 'background-revalidation',
      validatedBytes: result.body?.byteLength ?? 0,
      format: null,
      cacheStatus: result.cacheStatus,
      host,
      counter: result.status === 200 && result.cacheStatus !== 'BYPASS'
        ? 'backgroundRevalidationsSucceeded'
        : 'backgroundRevalidationsFailed',
    }))
    .catch(() => bestEffortObservation(redis, {
      outcome: 'background-revalidation',
      validatedBytes: 0,
      format: null,
      cacheStatus: 'REVALIDATED',
      host,
      counter: 'backgroundRevalidationsFailed',
    }))
    .finally(() => imageInflightState.backgroundTasks.delete(task));
  imageInflightState.backgroundTasks.add(task);
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
    const key = `bypass:${sha256Hex(normalizedOptions.cacheKey)}`;
    const entry = getOrCreateInflightWork(key, false, (signal) => (
      fetchValidatedBypass({ ...normalizedOptions, signal }, redis)
    ));
    return consumeInflightWork(entry, normalizedOptions.signal, 'BYPASS');
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
    await recoverMissingCacheFile(
      redis,
      generation,
      metaKey,
      cachedMeta,
      safeHost(upstreamUrl),
    );
    cachedMeta = null;
  }

  if (cachedMeta && requestStartedAt < cachedMeta.staleUntil) {
    const stale = await staleResult(
      cachedMeta,
      requestStartedAt,
      redis,
      generation,
      metaKey,
    );
    if (stale) {
      await bestEffortObservation(redis, {
        outcome: 'served',
        validatedBytes: cachedMeta.sizeBytes,
        format: cachedMeta.format,
        cacheStatus: 'STALE',
        host: safeHost(upstreamUrl),
        counter: 'staleResponses',
      });
      const workKey = `cache:${generation}:${keyHash}`;
      scheduleBackgroundRevalidation(
        workKey,
        redis,
        safeHost(upstreamUrl),
        (signal) => performCachedFill(
          { ...normalizedOptions, signal },
          redis,
          generation,
          keyHash,
          metaKey,
          cachedMeta,
          ttlSeconds,
          staleSeconds,
          'background',
        ),
      );
      return stale;
    }
    await recoverMissingCacheFile(
      redis,
      generation,
      metaKey,
      cachedMeta,
      safeHost(upstreamUrl),
    );
    cachedMeta = null;
  }

  await bestEffortObservation(redis, {
    outcome: 'served',
    validatedBytes: 0,
    format: null,
    cacheStatus: 'MISS',
    host: safeHost(upstreamUrl),
    counter: 'trueMisses',
  });
  const workKey = `cache:${generation}:${keyHash}`;
  const metaAtAdmission = cachedMeta;
  const entry = getOrCreateInflightWork(workKey, false, (signal) => performCachedFill(
    { ...normalizedOptions, signal },
    redis,
    generation,
    keyHash,
    metaKey,
    metaAtAdmission,
    ttlSeconds,
    staleSeconds,
    'visible',
  ));
  return consumeInflightWork(entry, normalizedOptions.signal, 'MISS');
}

export async function deleteCachedImageFile(meta: ImageCacheMeta): Promise<void> {
  await unlinkRelativePath(meta.relativePath);
}

export function beginImageCacheShutdown(): void {
  imageInflightState.shuttingDown = true;
  beginImageProcessingShutdown();
  for (const entry of imageInflightState.work.values()) {
    if (entry.background) entry.controller.abort();
  }
}

export async function awaitImageCacheBackgroundWork(): Promise<void> {
  await Promise.allSettled([...imageInflightState.backgroundTasks]);
}

export { getImageProcessingSnapshot };
