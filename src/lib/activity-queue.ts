import type { ServiceConnection } from '@prisma/client';
import { getSonarrClients, getRadarrClients, getLidarrClients } from '@/lib/service-helpers';
import type { QueueItem, QueueResponse } from '@/types';
import { getCachedJson, setCachedJson } from '@/lib/cache/json-cache';
import { getRedisClient } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { classifyQueueIssue } from '@/lib/queue-state';

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
    // Missing key defaults to 0, matching INCR's create-at-1 semantics: the
    // FIRST bump must change the seed (defaulting to 1 would make it a no-op).
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
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

// An instance that just failed is skipped for a while. The Activity page reads
// its queue page by page and refetches every loaded page on each poll, so one
// hung instance would otherwise cost a full timeout per page.
const FAILED_INSTANCE_BACKOFF_MS = 30_000;
const failedInstances = new Map<string, number>();

type QueueClient = {
  getQueue(page: number, pageSize: number, includeUnknown?: boolean): Promise<QueueResponse>;
};

// Fetch the entire queue across pages. The *arr queue endpoint paginates, and a
// single page misses everything past it — failed items beyond page 1 would never
// notify, and old items would look "new" when they finally scroll onto page 1.
// We page until we've collected totalRecords, with a safety cap on runaway queues.
//
// `includeUnknown` (Sonarr/Radarr) adds downloads the *arr tracks but could not
// match to a series or movie — a torrent added by hand into its category. They
// wait on a manual import like any other blocked download, so they count in the
// Activity badge and raise the same notifications, matching what the Activity
// page lists. Without it they would be listed there but never counted or
// announced.
export async function fetchAllQueueRecords(
  client: QueueClient,
  includeUnknown: boolean = false,
): Promise<QueueResponse> {
  const pageSize = 200;
  const maxPages = 50; // ~10k items; bounds a pathological queue
  const first = await client.getQueue(1, pageSize, includeUnknown);
  const records = [...first.records];
  for (let page = 2; records.length < first.totalRecords && page <= maxPages; page++) {
    const next = await client.getQueue(page, pageSize, includeUnknown);
    if (next.records.length === 0) break;
    records.push(...next.records);
  }
  if (records.length < first.totalRecords) {
    logger.warn(
      'Queue pagination capped',
      { collected: records.length, totalRecords: first.totalRecords },
      { scope: 'polling' },
    );
  }
  return { ...first, records, totalRecords: first.totalRecords };
}

type QueueRead = (client: QueueClient, includeUnknown: boolean) => Promise<{ records: QueueItem[]; totalRecords: number }>;

async function loadQueue(read: QueueRead): Promise<{ result: QueueResult; complete: boolean }> {
  // Tracks whether every configured instance answered. A partial result (an
  // instance was briefly unreachable, or listing connections failed) is still
  // returned live to this caller, but must NOT be cached — otherwise the missing
  // downloads would be served to every user for the whole TTL, even after the
  // instance recovers. Mirrors getCachedTaggedLibrary's "cache only a complete result".
  let complete = true;

  // Fan out across every instance of a type; one unreachable instance must not
  // blank the rest. Tag each record with its source + instance.
  const fanOut = async (
    clients: Array<{ connection: ServiceConnection; client: QueueClient }>,
    source: 'sonarr' | 'radarr' | 'lidarr',
  ) => {
    // Sonarr and Radarr also track downloads they cannot match to a series or
    // movie (a torrent added by hand into their category). Those wait on a
    // manual import, so Activity must list them — as each arr's own queue page
    // does. Lidarr is left on its default view: the import page cannot act on
    // its items.
    const includeUnknown = source !== 'lidarr';
    const perInstance = await Promise.all(
      clients.map(async ({ connection, client }) => {
        if ((failedInstances.get(connection.id) ?? 0) > Date.now()) {
          complete = false;
          return { records: [] as QueueItem[], totalRecords: 0 };
        }
        try {
          const q = await read(client, includeUnknown);
          failedInstances.delete(connection.id);
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
          failedInstances.set(connection.id, Date.now() + FAILED_INSTANCE_BACKOFF_MS);
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

async function getQueueCachedBy(view: string, read: QueueRead): Promise<QueueResult> {
  const version = await getQueueCacheVersion();
  const seed = `${version}:${view}`;
  const cached = await getCachedJson<QueueResult>(QUEUE_CACHE_SCOPE, seed);
  if (cached) return cached;

  // Collapse concurrent identical requests into one upstream fan-out.
  const existing = inflightQueue.get(seed);
  if (existing) return existing;

  const promise = (async () => {
    const { result, complete } = await loadQueue(read);
    // Only cache a complete snapshot; a partial poll is served live but left
    // uncached so a recovered instance reappears on the next request instead of
    // being masked by a stale partial aggregate for the whole TTL.
    if (complete) await setCachedJson(QUEUE_CACHE_SCOPE, seed, result, QUEUE_CACHE_TTL_SECONDS);
    return result;
  })().finally(() => inflightQueue.delete(seed));
  inflightQueue.set(seed, promise);
  return promise;
}

/** One page of every instance's queue (page N holds each instance's Nth page). */
export function getQueueCached(page: number, pageSize: number): Promise<QueueResult> {
  return getQueueCachedBy(`${page}:${pageSize}`, (client, includeUnknown) => client.getQueue(page, pageSize, includeUnknown));
}

/**
 * Every queued download waiting on a manual import, from each instance's whole
 * queue: the Failed tab must find one however far down the queue it sits.
 */
export function getQueueNeedingImportCached(): Promise<QueueResult> {
  return getQueueCachedBy('needs-import', async (client, includeUnknown) => {
    const { records } = await fetchAllQueueRecords(client, includeUnknown);
    const needing = records.filter((record) => classifyQueueIssue(record.trackedDownloadState, record.trackedDownloadStatus) === 'import');
    return { records: needing, totalRecords: needing.length };
  });
}
