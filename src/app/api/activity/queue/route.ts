import { NextRequest, NextResponse } from 'next/server';
import type { ServiceConnection } from '@prisma/client';
import { getSonarrClients, getRadarrClients, getLidarrClients } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import type { QueueItem } from '@/types';
import { withApiLogging } from '@/lib/api-logger';
import { getCachedJson, setCachedJson } from '@/lib/cache/json-cache';

// Live download progress changes second-to-second — a tiny window only collapses bursts.
const QUEUE_CACHE_HEADERS = {
  'Cache-Control': 'private, max-age=5, stale-while-revalidate=10',
  // Partition the private cache by session cookie so a capability-gated response can't be
  // replayed from the browser cache to a different (or logged-out) user within the TTL.
  'Vary': 'Cookie',
} as const;

// The queue is identical for every authorized user (it's the global *arr queue,
// not user-scoped), so a short server cache + in-flight dedupe collapses the
// 5–10 concurrent multi-user fan-outs in any few-second window into one upstream
// hit. The capability gate still runs per request before the cache is read.
const QUEUE_CACHE_SCOPE = 'activity-queue';
const QUEUE_CACHE_TTL_SECONDS = 5;

type QueueResult = { records: QueueItem[]; totalRecords: number };
const inflightQueue = new Map<string, Promise<QueueResult>>();

async function loadQueue(page: number, pageSize: number): Promise<QueueResult> {
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
          return { records: [] as QueueItem[], totalRecords: 0 };
        }
      }),
    );
    return {
      records: perInstance.flatMap((p) => p.records),
      totalRecords: perInstance.reduce((sum, p) => sum + p.totalRecords, 0),
    };
  };

  const [sonarrClients, radarrClients, lidarrClients] = await Promise.all([
    getSonarrClients().catch(() => []),
    getRadarrClients().catch(() => []),
    getLidarrClients().catch(() => []),
  ]);

  const [sonarr, radarr, lidarr] = await Promise.all([
    fanOut(sonarrClients, 'sonarr'),
    fanOut(radarrClients, 'radarr'),
    fanOut(lidarrClients, 'lidarr'),
  ]);

  return {
    records: [...sonarr.records, ...radarr.records, ...lidarr.records],
    totalRecords: sonarr.totalRecords + radarr.totalRecords + lidarr.totalRecords,
  };
}

async function getQueueCached(page: number, pageSize: number): Promise<QueueResult> {
  const seed = `${page}:${pageSize}`;
  const cached = await getCachedJson<QueueResult>(QUEUE_CACHE_SCOPE, seed);
  if (cached) return cached;

  // Collapse concurrent identical requests into one upstream fan-out.
  const existing = inflightQueue.get(seed);
  if (existing) return existing;

  const promise = (async () => {
    const result = await loadQueue(page, pageSize);
    await setCachedJson(QUEUE_CACHE_SCOPE, seed, result, QUEUE_CACHE_TTL_SECONDS);
    return result;
  })().finally(() => inflightQueue.delete(seed));
  inflightQueue.set(seed, promise);
  return promise;
}

async function getHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('activity.view');
  if (capError) return capError;

  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '50', 10);

    const result = await getQueueCached(page, pageSize);
    return NextResponse.json(result, { headers: QUEUE_CACHE_HEADERS });
  } catch (error) {
    console.error('Failed to fetch queue:', error);
    return NextResponse.json(
      { error: 'Failed to fetch queue' },
      { status: 500 }
    );
  }
}

export const GET = withApiLogging(getHandler, 'api/activity/queue');
