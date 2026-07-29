import { lstat, readdir, rm, unlink } from 'fs/promises';
import path from 'path';
import {
  acquireImageQuotaLock,
  deleteImageGenerationAccounting,
  type ImageAccountingRedis,
  type ImageIndexEntry,
  ImageCacheGenerationChangedError,
  ImageQuotaLockLostError,
  parseImageIndexEntry,
  reconcileImageCacheAccounting,
  releaseImageQuotaLock,
} from '@/lib/cache/image-cache-accounting';
import {
  IMAGE_CACHE_DIR,
  IMAGE_CACHE_MAX_BYTES,
  IMAGE_CACHE_MAX_ENTRIES,
} from '@/lib/cache/config';
import { buildImageIndexKey } from '@/lib/cache/keys';
import { getRedisClient } from '@/lib/redis';

const DAY_MS = 24 * 60 * 60 * 1000;
const IMAGE_ORPHAN_GRACE_MS = DAY_MS;
const IMAGE_TEMP_GRACE_MS = 60 * 60 * 1000;
const CACHE_GENERATION_KEY = 'helprr:cache:generation';
const CACHE_PURGE_STATUS_KEY = 'helprr:cache:purge:status';
const HASH_PATTERN = '[0-9a-f]{64}';
const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const IMAGE_FILE_RE = new RegExp(`^(${HASH_PATTERN})(?:-(${UUID_PATTERN}))?\\.bin$`, 'i');
const TEMP_FILE_RE = new RegExp(`^${HASH_PATTERN}(?:-${UUID_PATTERN})?\\.bin\\.tmp-${UUID_PATTERN}$`, 'i');
const GENERATION_DIR_RE = /^v([1-9][0-9]*)$/;

export interface ImageRetentionRedis extends ImageAccountingRedis {
  scan(
    cursor: string,
    options: { MATCH: string; COUNT: number },
  ): Promise<{ cursor: string; keys: string[] }>;
}

interface ReferencedMeta {
  entryKey: string;
  relativePath: string;
  sizeBytes: number;
  fetchedAt: number;
}

interface FileCandidate {
  kind: 'file';
  absolutePath: string;
  relativePath: string;
  size: number;
  mtimeMs: number;
  ino: number;
}

interface GenerationCandidate {
  kind: 'generation';
  absolutePath: string;
  generation: number;
  mtimeMs: number;
}

export interface ImageCacheRetentionResult {
  status: 'completed' | 'skipped';
  reason?:
    | 'generation-uninitialized'
    | 'purge-in-progress'
    | 'generation-changed'
    | 'quota-lock-busy'
    | 'quota-lock-lost';
  generation: number | null;
  metadataEntries: number;
  reconciledEntries: number;
  quotaBytes: number;
  quotaEntries: number;
  evictedEntries: number;
  deletedFiles: number;
  deletedBytes: number;
  deletedGenerations: number;
}

export interface ImageCacheRetentionOptions {
  rootDir?: string;
  nowMs?: number;
  redis?: ImageRetentionRedis;
  maxBytes?: number;
  maxEntries?: number;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function parseGeneration(raw: string | null): number | null {
  if (!raw) return null;
  const generation = Number.parseInt(raw, 10);
  return Number.isSafeInteger(generation) && generation > 0 ? generation : null;
}

async function scanKeys(redis: ImageRetentionRedis, pattern: string): Promise<string[]> {
  let cursor = '0';
  const keys = new Set<string>();
  do {
    const result = await redis.scan(cursor, { MATCH: pattern, COUNT: 200 });
    cursor = result.cursor;
    for (const key of result.keys) keys.add(key);
  } while (cursor !== '0');
  return [...keys];
}

function parseReferencedMeta(
  raw: string | null,
  generation: number,
  entryKey: string,
): ReferencedMeta | null {
  if (!raw || raw.length > 16_384) return null;
  const prefix = `helprr:cache:image:v${generation}:`;
  const keyHash = entryKey.startsWith(prefix) ? entryKey.slice(prefix.length) : '';
  if (!new RegExp(`^${HASH_PATTERN}$`, 'i').test(keyHash)) return null;

  try {
    const value = JSON.parse(raw) as {
      generation?: unknown;
      relativePath?: unknown;
      sizeBytes?: unknown;
      fetchedAt?: unknown;
      contentType?: unknown;
      format?: unknown;
    };
    if (
      value.generation !== generation
      || typeof value.relativePath !== 'string'
      || !Number.isSafeInteger(value.sizeBytes)
      || (value.sizeBytes as number) < 0
      || !Number.isSafeInteger(value.fetchedAt)
      || (value.fetchedAt as number) < 0
      || (value.format !== 'jpeg' && value.format !== 'png' && value.format !== 'webp')
      || (
        value.contentType !== 'image/jpeg'
        && value.contentType !== 'image/png'
        && value.contentType !== 'image/webp'
      )
    ) {
      return null;
    }

    const normalized = path.normalize(value.relativePath);
    if (path.dirname(normalized) !== `v${generation}`) return null;
    const match = IMAGE_FILE_RE.exec(path.basename(normalized));
    if (!match || match[1].toLowerCase() !== keyHash.toLowerCase()) return null;
    return {
      entryKey,
      relativePath: normalized,
      sizeBytes: value.sizeBytes as number,
      fetchedAt: value.fetchedAt as number,
    };
  } catch {
    return null;
  }
}

async function readMetadata(
  redis: ImageRetentionRedis,
  generation: number,
): Promise<{ keys: string[]; entries: Map<string, ReferencedMeta> }> {
  const keys = await scanKeys(redis, `helprr:cache:image:v${generation}:*`);
  const entries = new Map<string, ReferencedMeta>();
  for (let index = 0; index < keys.length; index += 100) {
    const chunk = keys.slice(index, index + 100);
    const values = await Promise.all(chunk.map((key) => redis.get(key)));
    values.forEach((raw, offset) => {
      const entryKey = chunk[offset];
      if (!entryKey) return;
      const meta = parseReferencedMeta(raw, generation, entryKey);
      if (meta) entries.set(entryKey, meta);
    });
  }
  return { keys, entries };
}

async function collectCandidates(
  rootDir: string,
  generation: number,
  initiallyReferencedPaths: Set<string>,
  nowMs: number,
): Promise<Array<FileCandidate | GenerationCandidate>> {
  let entries;
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }

  const candidates: Array<FileCandidate | GenerationCandidate> = [];
  for (const entry of entries) {
    const match = GENERATION_DIR_RE.exec(entry.name);
    if (!match || !entry.isDirectory()) continue;
    const entryGeneration = Number.parseInt(match[1], 10);
    const absolutePath = path.join(rootDir, entry.name);
    const info = await lstat(absolutePath).catch((error: unknown) => {
      if (isMissing(error)) return null;
      throw error;
    });
    if (!info || !info.isDirectory() || info.isSymbolicLink()) continue;

    if (entryGeneration !== generation) {
      if (info.mtimeMs < nowMs - IMAGE_ORPHAN_GRACE_MS) {
        candidates.push({
          kind: 'generation',
          absolutePath,
          generation: entryGeneration,
          mtimeMs: info.mtimeMs,
        });
      }
      continue;
    }

    const files = await readdir(absolutePath, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile()) continue;
      const relativePath = path.join(entry.name, file.name);
      const isImage = IMAGE_FILE_RE.test(file.name);
      const isTemp = TEMP_FILE_RE.test(file.name);
      if (
        (!isImage && !isTemp)
        || (isImage && initiallyReferencedPaths.has(relativePath))
      ) {
        continue;
      }

      const filePath = path.join(absolutePath, file.name);
      const fileInfo = await lstat(filePath).catch((error: unknown) => {
        if (isMissing(error)) return null;
        throw error;
      });
      if (!fileInfo || !fileInfo.isFile() || fileInfo.isSymbolicLink()) continue;
      const graceMs = isTemp ? IMAGE_TEMP_GRACE_MS : IMAGE_ORPHAN_GRACE_MS;
      if (fileInfo.mtimeMs >= nowMs - graceMs) continue;
      candidates.push({
        kind: 'file',
        absolutePath: filePath,
        relativePath,
        size: fileInfo.size,
        mtimeMs: fileInfo.mtimeMs,
        ino: fileInfo.ino,
      });
    }
  }
  return candidates;
}

async function getDirectoryUsage(directory: string): Promise<{ bytes: number; files: number }> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return { bytes: 0, files: 0 };
    throw error;
  }

  let bytes = 0;
  let files = 0;
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await getDirectoryUsage(entryPath);
      bytes += nested.bytes;
      files += nested.files;
    } else if (entry.isFile()) {
      const info = await lstat(entryPath);
      bytes += info.size;
      files += 1;
    }
  }
  return { bytes, files };
}

async function productionRedis(): Promise<ImageRetentionRedis> {
  return await getRedisClient() as unknown as ImageRetentionRedis;
}

function skipped(
  reason: ImageCacheRetentionResult['reason'],
  generation: number | null,
  metadataEntries = 0,
): ImageCacheRetentionResult {
  return {
    status: 'skipped',
    reason,
    generation,
    metadataEntries,
    reconciledEntries: 0,
    quotaBytes: 0,
    quotaEntries: 0,
    evictedEntries: 0,
    deletedFiles: 0,
    deletedBytes: 0,
    deletedGenerations: 0,
  };
}

function lruTimestamp(
  indexed: Record<string, string>,
  meta: ReferencedMeta,
): number {
  const entry = parseImageIndexEntry(indexed[meta.entryKey] ?? null);
  if (
    entry
    && entry.entryKey === meta.entryKey
    && entry.relativePath === meta.relativePath
    && entry.sizeBytes === meta.sizeBytes
  ) {
    return entry.lastUsedAt;
  }
  return meta.fetchedAt;
}

function enforceQuota(
  entries: ImageIndexEntry[],
  maxBytes: number,
  maxEntries: number,
): {
  retained: ImageIndexEntry[];
  evicted: ImageIndexEntry[];
  bytes: number;
} {
  const byLru = [...entries].sort((left, right) => (
    left.lastUsedAt - right.lastUsedAt
    || left.entryKey.localeCompare(right.entryKey)
  ));
  let bytes = byLru.reduce((total, entry) => total + entry.sizeBytes, 0);
  const evicted: ImageIndexEntry[] = [];
  while (bytes > maxBytes || byLru.length > maxEntries) {
    const oldest = byLru.shift();
    if (!oldest) break;
    evicted.push(oldest);
    bytes -= oldest.sizeBytes;
  }
  return { retained: byLru, evicted, bytes };
}

async function unlinkCandidate(candidate: FileCandidate): Promise<boolean> {
  const current = await lstat(candidate.absolutePath).catch((error: unknown) => {
    if (isMissing(error)) return null;
    throw error;
  });
  if (
    !current
    || !current.isFile()
    || current.isSymbolicLink()
    || current.ino !== candidate.ino
    || current.mtimeMs !== candidate.mtimeMs
    || current.size !== candidate.size
  ) {
    return false;
  }
  try {
    await unlink(candidate.absolutePath);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

/**
 * Reconcile Redis metadata, the per-generation quota index, and immutable
 * files. Redis and the quota lock must be available before any filesystem
 * mutation; metadata is removed before quota/corrupt files are unlinked.
 */
export async function pruneOrphanImageCache(
  options: ImageCacheRetentionOptions = {},
): Promise<ImageCacheRetentionResult> {
  const rootDir = path.resolve(options.rootDir ?? IMAGE_CACHE_DIR);
  const nowMs = options.nowMs ?? Date.now();
  const maxBytes = options.maxBytes ?? IMAGE_CACHE_MAX_BYTES;
  const maxEntries = options.maxEntries ?? IMAGE_CACHE_MAX_ENTRIES;
  const redis = options.redis ?? await productionRedis();
  const generation = parseGeneration(await redis.get(CACHE_GENERATION_KEY));
  if (!generation) return skipped('generation-uninitialized', null);
  if (await redis.get(CACHE_PURGE_STATUS_KEY) === 'purging') {
    return skipped('purge-in-progress', generation);
  }

  // Read twice around the filesystem scan. Metadata created during the sweep
  // is included by the second read before the quota lock freezes registrations.
  const first = await readMetadata(redis, generation);
  const firstPaths = new Set([...first.entries.values()].map((entry) => entry.relativePath));
  const candidates = await collectCandidates(rootDir, generation, firstPaths, nowMs);
  const second = await readMetadata(redis, generation);

  if (parseGeneration(await redis.get(CACHE_GENERATION_KEY)) !== generation) {
    return skipped('generation-changed', generation, second.keys.length);
  }
  if (await redis.get(CACHE_PURGE_STATUS_KEY) === 'purging') {
    return skipped('purge-in-progress', generation, second.keys.length);
  }

  const quotaToken = await acquireImageQuotaLock(redis, generation);
  if (!quotaToken) return skipped('quota-lock-busy', generation, second.keys.length);

  let retained: ImageIndexEntry[] = [];
  let quotaEvicted: ImageIndexEntry[] = [];
  const invalidReferencedFiles = new Map<string, number>();
  let lockedMetadata = second;
  let quotaBytes = 0;

  try {
    if (parseGeneration(await redis.get(CACHE_GENERATION_KEY)) !== generation) {
      return skipped('generation-changed', generation, second.keys.length);
    }
    if (await redis.get(CACHE_PURGE_STATUS_KEY) === 'purging') {
      return skipped('purge-in-progress', generation, second.keys.length);
    }

    // Registration uses the same quota lock. Re-read after acquiring it so a
    // fill that committed between the pre-lock scan and lock acquisition is
    // included rather than being dropped from the rebuilt index.
    lockedMetadata = await readMetadata(redis, generation);
    if (parseGeneration(await redis.get(CACHE_GENERATION_KEY)) !== generation) {
      return skipped('generation-changed', generation, lockedMetadata.keys.length);
    }
    if (await redis.get(CACHE_PURGE_STATUS_KEY) === 'purging') {
      return skipped('purge-in-progress', generation, lockedMetadata.keys.length);
    }

    const invalidMetadataKeys = new Set<string>(
      lockedMetadata.keys.filter((key) => !lockedMetadata.entries.has(key)),
    );
    const indexed = await redis.hGetAll(buildImageIndexKey(generation));
    const validEntries: ImageIndexEntry[] = [];
    for (const meta of lockedMetadata.entries.values()) {
      const absolutePath = path.resolve(rootDir, meta.relativePath);
      if (!absolutePath.startsWith(`${rootDir}${path.sep}`)) {
        invalidMetadataKeys.add(meta.entryKey);
        continue;
      }
      const info = await lstat(absolutePath).catch((error: unknown) => {
        if (isMissing(error)) return null;
        throw error;
      });
      if (
        !info
        || !info.isFile()
        || info.isSymbolicLink()
        || info.size !== meta.sizeBytes
      ) {
        invalidMetadataKeys.add(meta.entryKey);
        if (info?.isFile() && !info.isSymbolicLink()) {
          invalidReferencedFiles.set(meta.relativePath, info.size);
        }
        continue;
      }
      validEntries.push({
        entryKey: meta.entryKey,
        relativePath: meta.relativePath,
        sizeBytes: meta.sizeBytes,
        lastUsedAt: lruTimestamp(indexed, meta),
      });
    }

    const quota = enforceQuota(validEntries, maxBytes, maxEntries);
    retained = quota.retained;
    quotaEvicted = quota.evicted;
    quotaBytes = quota.bytes;
    for (const entry of quotaEvicted) invalidMetadataKeys.add(entry.entryKey);

    await reconcileImageCacheAccounting(
      redis,
      generation,
      retained,
      [...invalidMetadataKeys],
      quotaEvicted.length,
      quotaToken,
    );
  } catch (error) {
    if (error instanceof ImageQuotaLockLostError) {
      return skipped('quota-lock-lost', generation, lockedMetadata.keys.length);
    }
    if (error instanceof ImageCacheGenerationChangedError) {
      return skipped('generation-changed', generation, lockedMetadata.keys.length);
    }
    throw error;
  } finally {
    await releaseImageQuotaLock(redis, generation, quotaToken).catch(() => undefined);
  }

  const retainedPaths = new Set(retained.map((entry) => entry.relativePath));
  let deletedFiles = 0;
  let deletedBytes = 0;
  let deletedGenerations = 0;
  const immediatelyUnlinked = new Set<string>();

  // These files lost metadata in the reconciliation transaction above, so
  // deletion failures are safe orphan-retention work.
  const immediateFiles = new Map<string, number>(invalidReferencedFiles);
  for (const entry of quotaEvicted) {
    immediateFiles.set(entry.relativePath, entry.sizeBytes);
  }
  for (const [relativePath, size] of immediateFiles) {
    const absolutePath = path.resolve(rootDir, relativePath);
    if (!absolutePath.startsWith(`${rootDir}${path.sep}`)) continue;
    try {
      await unlink(absolutePath);
      deletedFiles += 1;
      deletedBytes += size;
      immediatelyUnlinked.add(relativePath);
    } catch (error) {
      if (!isMissing(error)) {
        // Leave the metadata-free immutable file for the next orphan sweep.
      }
    }
  }

  for (const candidate of candidates) {
    if (candidate.kind === 'file') {
      if (
        retainedPaths.has(candidate.relativePath)
        || immediatelyUnlinked.has(candidate.relativePath)
      ) {
        continue;
      }
      if (await unlinkCandidate(candidate)) {
        deletedFiles += 1;
        deletedBytes += candidate.size;
      }
      continue;
    }

    const current = await lstat(candidate.absolutePath).catch((error: unknown) => {
      if (isMissing(error)) return null;
      throw error;
    });
    if (
      !current
      || !current.isDirectory()
      || current.isSymbolicLink()
      || current.mtimeMs !== candidate.mtimeMs
    ) {
      continue;
    }
    const usage = await getDirectoryUsage(candidate.absolutePath);
    const abandonedMetadata = await scanKeys(
      redis,
      `helprr:cache:image:v${candidate.generation}:*`,
    );
    await deleteImageGenerationAccounting(
      redis,
      candidate.generation,
      abandonedMetadata,
    );
    await rm(candidate.absolutePath, { recursive: true, force: true });
    deletedFiles += usage.files;
    deletedBytes += usage.bytes;
    deletedGenerations += 1;
  }

  return {
    status: 'completed',
    generation,
    metadataEntries: lockedMetadata.keys.length,
    reconciledEntries: retained.length,
    quotaBytes,
    quotaEntries: retained.length,
    evictedEntries: quotaEvicted.length,
    deletedFiles,
    deletedBytes,
    deletedGenerations,
  };
}
