import { lstat, readdir, rm, unlink } from 'fs/promises';
import path from 'path';
import { IMAGE_CACHE_DIR } from '@/lib/cache/config';
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

interface ImageRetentionRedis {
  get(key: string): Promise<string | null>;
  scan(cursor: string, options: { MATCH: string; COUNT: number }): Promise<{ cursor: string; keys: string[] }>;
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
  reason?: 'generation-uninitialized' | 'purge-in-progress' | 'generation-changed';
  generation: number | null;
  metadataEntries: number;
  deletedFiles: number;
  deletedBytes: number;
  deletedGenerations: number;
}

export interface ImageCacheRetentionOptions {
  rootDir?: string;
  nowMs?: number;
  redis?: ImageRetentionRedis;
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

function validReferencedPath(raw: string | null, generation: number, key: string): string | null {
  if (!raw || raw.length > 16_384) return null;

  const prefix = `helprr:cache:image:v${generation}:`;
  const keyHash = key.startsWith(prefix) ? key.slice(prefix.length) : '';
  if (!new RegExp(`^${HASH_PATTERN}$`, 'i').test(keyHash)) return null;

  try {
    const value = JSON.parse(raw) as { generation?: unknown; relativePath?: unknown };
    if (value.generation !== generation || typeof value.relativePath !== 'string') return null;

    const normalized = path.normalize(value.relativePath);
    const expectedDirectory = `v${generation}`;
    if (path.dirname(normalized) !== expectedDirectory) return null;

    const match = IMAGE_FILE_RE.exec(path.basename(normalized));
    if (!match || match[1].toLowerCase() !== keyHash.toLowerCase()) return null;
    return normalized;
  } catch {
    return null;
  }
}

async function readReferencedPaths(
  redis: ImageRetentionRedis,
  generation: number,
): Promise<{ paths: Set<string>; entries: number }> {
  const keys = await scanKeys(redis, `helprr:cache:image:v${generation}:*`);
  const paths = new Set<string>();

  for (let index = 0; index < keys.length; index += 100) {
    const chunk = keys.slice(index, index + 100);
    const values = await Promise.all(chunk.map((key) => redis.get(key)));
    values.forEach((raw, offset) => {
      const relativePath = validReferencedPath(raw, generation, chunk[offset]);
      if (relativePath) paths.add(relativePath);
    });
  }

  return { paths, entries: keys.length };
}

async function collectCandidates(
  rootDir: string,
  generation: number,
  referencedPaths: Set<string>,
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
      if ((!isImage && !isTemp) || (isImage && referencedPaths.has(relativePath))) continue;

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
  const redis = await getRedisClient();
  return {
    get: (key) => redis.get(key),
    scan: (cursor, options) => redis.scan(cursor, options),
  };
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
    deletedFiles: 0,
    deletedBytes: 0,
    deletedGenerations: 0,
  };
}

/**
 * Remove files no active Redis image metadata can reference. Redis is treated
 * as authoritative and must be readable before any filesystem mutation.
 */
export async function pruneOrphanImageCache(
  options: ImageCacheRetentionOptions = {},
): Promise<ImageCacheRetentionResult> {
  const rootDir = path.resolve(options.rootDir ?? IMAGE_CACHE_DIR);
  const nowMs = options.nowMs ?? Date.now();
  const redis = options.redis ?? await productionRedis();
  const generation = parseGeneration(await redis.get(CACHE_GENERATION_KEY));
  if (!generation) return skipped('generation-uninitialized', null);
  if (await redis.get(CACHE_PURGE_STATUS_KEY) === 'purging') {
    return skipped('purge-in-progress', generation);
  }

  // Read twice around the filesystem scan. The union is deliberately
  // conservative: metadata created during the sweep always protects its file.
  const firstReferences = await readReferencedPaths(redis, generation);
  const candidates = await collectCandidates(rootDir, generation, firstReferences.paths, nowMs);
  const secondReferences = await readReferencedPaths(redis, generation);
  const referencedPaths = new Set([...firstReferences.paths, ...secondReferences.paths]);

  const currentGeneration = parseGeneration(await redis.get(CACHE_GENERATION_KEY));
  if (currentGeneration !== generation) {
    return skipped('generation-changed', generation, secondReferences.entries);
  }
  if (await redis.get(CACHE_PURGE_STATUS_KEY) === 'purging') {
    return skipped('purge-in-progress', generation, secondReferences.entries);
  }

  let deletedFiles = 0;
  let deletedBytes = 0;
  let deletedGenerations = 0;

  for (const candidate of candidates) {
    if (candidate.kind === 'file') {
      if (referencedPaths.has(candidate.relativePath)) continue;

      const current = await lstat(candidate.absolutePath).catch((error: unknown) => {
        if (isMissing(error)) return null;
        throw error;
      });
      // A writer changed or replaced the file after discovery; leave it for a
      // later sweep rather than deleting uncertain state.
      if (
        !current
        || !current.isFile()
        || current.isSymbolicLink()
        || current.ino !== candidate.ino
        || current.mtimeMs !== candidate.mtimeMs
        || current.size !== candidate.size
      ) {
        continue;
      }

      await unlink(candidate.absolutePath).catch((error: unknown) => {
        if (!isMissing(error)) throw error;
      });
      deletedFiles += 1;
      deletedBytes += candidate.size;
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
    await rm(candidate.absolutePath, { recursive: true, force: true });
    deletedFiles += usage.files;
    deletedBytes += usage.bytes;
    deletedGenerations += 1;
  }

  return {
    status: 'completed',
    generation,
    metadataEntries: secondReferences.entries,
    deletedFiles,
    deletedBytes,
    deletedGenerations,
  };
}
