import { rm, readdir, stat } from 'fs/promises';
import path from 'path';
import { getRedisClient } from '@/lib/redis';
import { IMAGE_CACHE_DIR } from '@/lib/cache/config';
import {
  bumpCacheGeneration,
  getCacheGeneration,
  getCachePurgeStatus,
  getLastCachePurgedAt,
  setCachePurgeStatus,
  setLastCachePurgedAt,
} from '@/lib/cache/state';

export interface CacheUsageSummary {
  imageBytes: number;
  tmdbApiBytes: number;
  totalBytes: number;
  imageFiles: number;
  tmdbEntries: number;
}

export interface CachePurgeResult {
  generation: number;
  deletedImageBytes: number;
  deletedImageFiles: number;
  deletedTmdbBytes: number;
  deletedTmdbEntries: number;
  deletedTotalBytes: number;
  purgedAt: string;
}

async function getDirectoryUsage(dirPath: string): Promise<{ bytes: number; files: number }> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    let bytes = 0;
    let files = 0;

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const nested = await getDirectoryUsage(fullPath);
        bytes += nested.bytes;
        files += nested.files;
        continue;
      }

      if (entry.isFile()) {
        const info = await stat(fullPath);
        bytes += info.size;
        files += 1;
      }
    }

    return { bytes, files };
  } catch {
    return { bytes: 0, files: 0 };
  }
}

async function scanRedisKeys(pattern: string): Promise<string[]> {
  try {
    const redis = await getRedisClient();
    let cursor = '0';
    const keys: string[] = [];

    do {
      const result = await redis.scan(cursor, {
        MATCH: pattern,
        COUNT: 200,
      });
      cursor = result.cursor;
      keys.push(...result.keys);
    } while (cursor !== '0');

    return keys;
  } catch {
    return [];
  }
}

async function getRedisKeysUsage(keys: string[]): Promise<{ bytes: number; entries: number }> {
  if (keys.length === 0) {
    return { bytes: 0, entries: 0 };
  }

  try {
    const redis = await getRedisClient();
    let bytes = 0;

    for (let index = 0; index < keys.length; index += 100) {
      const chunk = keys.slice(index, index + 100);
      const lengths = await Promise.all(
        chunk.map(async (key) => {
          try {
            return await redis.strLen(key);
          } catch {
            return 0;
          }
        })
      );
      bytes += lengths.reduce((sum, len) => sum + (Number.isFinite(len) ? len : 0), 0);
    }

    return { bytes, entries: keys.length };
  } catch {
    return { bytes: 0, entries: keys.length };
  }
}

async function deleteRedisKeys(keys: string[]): Promise<void> {
  if (keys.length === 0) return;

  try {
    const redis = await getRedisClient();
    for (let index = 0; index < keys.length; index += 500) {
      const chunk = keys.slice(index, index + 500);
      if (chunk.length === 0) continue;
      await redis.del(chunk);
    }
  } catch {
    // noop
  }
}

function generationImageDirectory(generation: number): string {
  return path.join(IMAGE_CACHE_DIR, `v${generation}`);
}

async function purgeGeneration(generation: number): Promise<CachePurgeResult> {
  const imageDir = generationImageDirectory(generation);
  const imageUsage = await getDirectoryUsage(imageDir);

  const imageMetaKeys = await scanRedisKeys(`helprr:cache:image:v${generation}:*`);
  const tmdbKeys = await scanRedisKeys(`helprr:cache:tmdb:v${generation}:*`);
  const tmdbUsage = await getRedisKeysUsage(tmdbKeys);

  await Promise.all([
    rm(imageDir, { recursive: true, force: true }).catch(() => undefined),
    deleteRedisKeys(imageMetaKeys),
    deleteRedisKeys(tmdbKeys),
  ]);

  const purgedAt = new Date().toISOString();
  await setLastCachePurgedAt(purgedAt);

  return {
    generation,
    deletedImageBytes: imageUsage.bytes,
    deletedImageFiles: imageUsage.files,
    deletedTmdbBytes: tmdbUsage.bytes,
    deletedTmdbEntries: tmdbUsage.entries,
    deletedTotalBytes: imageUsage.bytes + tmdbUsage.bytes,
    purgedAt,
  };
}

export async function getActiveCacheUsage(): Promise<CacheUsageSummary> {
  const generation = await getCacheGeneration();
  const imageUsage = await getDirectoryUsage(generationImageDirectory(generation));
  const tmdbKeys = await scanRedisKeys(`helprr:cache:tmdb:v${generation}:*`);
  const tmdbUsage = await getRedisKeysUsage(tmdbKeys);

  return {
    imageBytes: imageUsage.bytes,
    tmdbApiBytes: tmdbUsage.bytes,
    totalBytes: imageUsage.bytes + tmdbUsage.bytes,
    imageFiles: imageUsage.files,
    tmdbEntries: tmdbUsage.entries,
  };
}

export async function purgeActiveCache(): Promise<CachePurgeResult> {
  const generation = await getCacheGeneration();
  await setCachePurgeStatus('purging');

  try {
    return await purgeGeneration(generation);
  } finally {
    await setCachePurgeStatus('idle');
  }
}

export async function disableCachingAndPurgeCaches(): Promise<CachePurgeResult> {
  const previousGeneration = await getCacheGeneration();
  await setCachePurgeStatus('purging');

  try {
    await bumpCacheGeneration();
    return await purgeGeneration(previousGeneration);
  } finally {
    await setCachePurgeStatus('idle');
  }
}

export async function getCacheMaintenanceMeta(): Promise<{ status: 'idle' | 'purging'; lastPurgedAt: string | null }> {
  const [status, lastPurgedAt] = await Promise.all([
    getCachePurgeStatus(),
    getLastCachePurgedAt(),
  ]);

  return { status, lastPurgedAt };
}
