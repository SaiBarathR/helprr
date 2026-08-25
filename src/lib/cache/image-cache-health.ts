import { randomUUID } from 'crypto';
import { mkdir, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { IMAGE_CACHE_DIR } from '@/lib/cache/config';
import {
  pruneOrphanImageCache,
  type ImageRetentionRedis,
} from '@/lib/cache/image-cache-retention';
import { getRedisClient } from '@/lib/redis';

export type ImageCacheHealthStatus =
  | 'healthy'
  | 'revalidating'
  | 'degraded-storage'
  | 'accounting-unavailable';

export interface ImageCacheStorageHealth {
  status: ImageCacheHealthStatus;
  checkedAt: string | null;
}

const HEALTH_STATE_KEY = '__helprrImageCacheHealth' as const;
const healthGlobal = globalThis as typeof globalThis & {
  [HEALTH_STATE_KEY]?: ImageCacheStorageHealth;
};

const healthState = (healthGlobal[HEALTH_STATE_KEY] ??= {
  status: 'revalidating',
  checkedAt: null,
});

function updateHealth(status: ImageCacheHealthStatus): ImageCacheStorageHealth {
  healthState.status = status;
  healthState.checkedAt = new Date().toISOString();
  return { ...healthState };
}

function parseGeneration(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function activeGeneration(redis: ImageRetentionRedis): Promise<number> {
  const current = parseGeneration(await redis.get('helprr:cache:generation'));
  if (current) return current;
  const initialized = await redis.set('helprr:cache:generation', '1', { NX: true });
  if (initialized === 'OK') return 1;
  const raced = parseGeneration(await redis.get('helprr:cache:generation'));
  if (!raced) throw new Error('Image cache generation unavailable');
  return raced;
}

async function probeWritableDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const probe = path.join(directory, `.write-probe-${randomUUID()}`);
  try {
    await writeFile(probe, '', { flag: 'wx' });
  } finally {
    await unlink(probe).catch(() => undefined);
  }
}

/**
 * Non-fatal startup probe and reconciliation. It never prints a configured
 * path or filesystem contents, and storage failure leaves the validated BYPASS
 * route available.
 */
export async function initializeImageCacheStorage(): Promise<ImageCacheStorageHealth> {
  const root = path.resolve(IMAGE_CACHE_DIR);
  try {
    await probeWritableDirectory(root);
  } catch {
    return updateHealth('degraded-storage');
  }

  let redis: ImageRetentionRedis;
  try {
    redis = await getRedisClient() as unknown as ImageRetentionRedis;
  } catch {
    return updateHealth('accounting-unavailable');
  }

  let generation: number;
  try {
    generation = await activeGeneration(redis);
  } catch {
    return updateHealth('accounting-unavailable');
  }

  try {
    await probeWritableDirectory(path.join(root, `v${generation}`));
  } catch {
    return updateHealth('degraded-storage');
  }

  try {
    const reconciliation = await pruneOrphanImageCache({ redis });
    return updateHealth(
      reconciliation.status === 'completed' ? 'healthy' : 'revalidating',
    );
  } catch {
    return updateHealth('accounting-unavailable');
  }
}

export function getImageCacheStorageHealth(): ImageCacheStorageHealth {
  return { ...healthState };
}
