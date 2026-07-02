import type { ServiceConnection } from '@prisma/client';
import { getSonarrClients, getRadarrClients, getLidarrClients } from '@/lib/service-helpers';
import type { QueueItem } from '@/types';
import { getCachedJson, setCachedJson } from '@/lib/cache/json-cache';
import { getRedisClient } from '@/lib/redis';

// The queue is identical for every authorized user (it's the global *arr queue,
// not user-scoped), so a short server cache + in-flight dedupe collapses the
// 5–10 concurrent multi-user fan-outs in any few-second window into one upstream
// hit. /api/activity/queue gates per request before the cache is read.
const QUEUE_CACHE_SCOPE = 'activity-queue';
const QUEUE_CACHE_TTL_SECONDS = 5;

// Version stamp folded into the cache seed. Bumped on queue-item removal so
// every cached page (any page/pageSize combination) AND any in-flight load
// keyed to the old seed become unreachable at once — a plain key delete covers
// only one seed and can be silently undone by an in-flight fan-out completing
// after the delete.
const QUEUE_CACHE_VERSION_KEY = 'helprr:cache:queue:ver';

async function getQueueCacheVersion(): Promise<number> {
  try {
    const redis = await getRedisClient();
    const value = await redis.get(QUEUE_CACHE_VERSION_KEY);
    const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  } catch {
    return 1;
  }
}

export async function bumpQueueCacheVersion(): Promise<void> {
  try {
    const redis = await getRedisClient();
    await redis.incr(QUEUE_CACHE_VERSION_KEY);
  } catch {
    // Best-effort: the 5s TTL is the backstop.
  }
}

export type QueueResult = { records: QueueItem[]; totalRecords: number };
const inflightQueue = new Map<string, Promise<QueueResult>>();

async function loadQueue(page: number, pageSize: number): Promise<{ result: QueueResult; complete: boolean }> {
  // Tracks whether every configured instance answered. A partial result (an
  // instance was briefly unreachable, or listing connections failed) is still
  // returned live to this caller, but must NOT be cached — otherwise the missing
  // downloads would be served to every user for the whole TTL, even after the
  // instance recovers. Mirrors getCachedTaggedLibrary's "cache only a complete result".
  let complete = true;

  // Fan out across every instance of a type; one unreachable instance must not
  // blank the rest. Tag each record with its source + instance.
  const fanOut = async (
    clients: Array<{ connection: ServiceConnection; client: { getQueue(p: number, s: number): Promise<{ records: QueueItem[]; totalRecords: number }> } }>,
    source: 'sonarr' | 'radarr' | 'lidarr',
  ) => {
    const perInstance = await Promise.all(
      clients.map(async ({ connection, client }) => {
        try {
          const q = await client.getQueue(page, pageSize);
          return {
            records: q.records.map((record: QueueItem) => ({
              ...record,
              source,
              instanceId: connection.id,
              instanceLabel: connection.label,
            })),
            totalRecords: q.totalRecords,
          };
        } catch {
          complete = false;
          return { records: [] as QueueItem[], totalRecords: 0 };
        }
      }),
    );
    return {
      records: perInstance.flatMap((p) => p.records),
      totalRecords: perInstance.reduce((sum, p) => sum + p.totalRecords, 0),
    };
  };

  // A failure listing connections (e.g. a transient DB blip) also yields a
  // partial aggregate, so treat it as incomplete too.
  const listClients = async <T>(fn: () => Promise<T[]>): Promise<T[]> => {
    try {
      return await fn();
    } catch {
      complete = false;
      return [];
    }
  };
  const [sonarrClients, radarrClients, lidarrClients] = await Promise.all([
    listClients(getSonarrClients),
    listClients(getRadarrClients),
    listClients(getLidarrClients),
  ]);

  const [sonarr, radarr, lidarr] = await Promise.all([
    fanOut(sonarrClients, 'sonarr'),
    fanOut(radarrClients, 'radarr'),
    fanOut(lidarrClients, 'lidarr'),
  ]);

  return {
    result: {
      records: [...sonarr.records, ...radarr.records, ...lidarr.records],
      totalRecords: sonarr.totalRecords + radarr.totalRecords + lidarr.totalRecords,
    },
    complete,
  };
}

export async function getQueueCached(page: number, pageSize: number): Promise<QueueResult> {
  const version = await getQueueCacheVersion();
  const seed = `${version}:${page}:${pageSize}`;
  const cached = await getCachedJson<QueueResult>(QUEUE_CACHE_SCOPE, seed);
  if (cached) return cached;

  // Collapse concurrent identical requests into one upstream fan-out.
  const existing = inflightQueue.get(seed);
  if (existing) return existing;

  const promise = (async () => {
    const { result, complete } = await loadQueue(page, pageSize);
    // Only cache a complete snapshot; a partial poll is served live but left
    // uncached so a recovered instance reappears on the next request instead of
    // being masked by a stale partial aggregate for the whole TTL.
    if (complete) await setCachedJson(QUEUE_CACHE_SCOPE, seed, result, QUEUE_CACHE_TTL_SECONDS);
    return result;
  })().finally(() => inflightQueue.delete(seed));
  inflightQueue.set(seed, promise);
  return promise;
}
