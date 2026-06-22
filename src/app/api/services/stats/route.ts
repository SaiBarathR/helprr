import { NextResponse } from 'next/server';
import { getSonarrClients, getRadarrClients, getLidarrClients, getJellyfinClient } from '@/lib/service-helpers';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import type { DiskSpace, ServicesStatsResponse } from '@/types/service-stats';
import { withApiLogging } from '@/lib/api-logger';
import { getCachedJson, setCachedJson } from '@/lib/cache/json-cache';
import { dedupeDiskSpace } from '@/lib/disk-space';

function mapDiskSpace(disks: Array<DiskSpace | null | undefined>): DiskSpace[] {
  return disks.filter((disk): disk is DiskSpace => Boolean(disk));
}

type ArrAgg = { total: number; downloads: number; hasDownload: boolean; disks: DiskSpace[] };

type StatClient = {
  getQueue(page: number, pageSize: number): Promise<{ totalRecords: number }>;
  getDiskSpace(): Promise<DiskSpace[]>;
};

type JellyfinSlice = NonNullable<ServicesStatsResponse['jellyfin']>;

// /api/services/stats is the heaviest endpoint: per service type it pulls the
// ENTIRE library (just for .length — no count-only upstream endpoint exists),
// plus a queue probe and disk space, across every instance. Three independent
// consumers (stats-grid, storage-usage, insights) hit it on every refresh tick
// under different client cache keys, so a short server cache + in-flight dedupe
// collapses the duplicate fan-outs onto one upstream hit per slice. The response
// is capability-gated per user, so we cache each service's RAW aggregate slice
// (identical for every authorized viewer) and assemble + gate per request below.
const STATS_CACHE_SCOPE = 'services-stats';
const STATS_CACHE_TTL_SECONDS = 10;

// One promise per slice seed ('radarr'|'sonarr'|'lidarr'|'jellyfin') collapses
// concurrent identical fan-outs into a single upstream call (mirrors the queue route).
const inflightArr = new Map<string, Promise<ArrAgg | null>>();
const inflightJellyfin = new Map<string, Promise<JellyfinSlice | null>>();

// One service type, summed across its instances. Per instance the 3 reads
// (count, queue, disk) are independent and fan out together; across instances
// they fan out too. Returns a null agg when none is configured, so the caller
// leaves the count stat unset (vs. 0). `complete` is true only when every
// configured instance answered every read — a partial result is returned live
// but not cached (mirrors getCachedTaggedLibrary / the queue route) so a
// recovered instance reappears next request instead of a stale partial count
// being pinned for the whole TTL.
async function loadArrSlice<C extends StatClient>(
  getClients: () => Promise<Array<{ client: C }>>,
  getCount: (client: C) => Promise<number>,
): Promise<{ agg: ArrAgg | null; complete: boolean }> {
  let instances: Array<{ client: C }>;
  try {
    instances = await getClients();
  } catch {
    return { agg: null, complete: false };
  }
  if (instances.length === 0) return { agg: null, complete: true };

  let complete = true;
  const per = await Promise.all(
    instances.map(async ({ client }) => {
      // Settle each read independently so one failing call doesn't drop a
      // sibling's data. This is slightly MORE resilient than the old sequential
      // try: a failed library count no longer suppresses the queue/disk reads,
      // so activeDownloads can now surface even when only the count call fails.
      // Any rejection marks the slice incomplete so it isn't cached.
      const [countRes, queueRes, diskRes] = await Promise.allSettled([
        getCount(client),
        client.getQueue(1, 1),
        client.getDiskSpace(),
      ]);
      if (
        countRes.status === 'rejected' ||
        queueRes.status === 'rejected' ||
        diskRes.status === 'rejected'
      ) {
        complete = false;
      }
      return {
        count: countRes.status === 'fulfilled' ? countRes.value : 0,
        downloads: queueRes.status === 'fulfilled' ? queueRes.value.totalRecords ?? 0 : 0,
        hasDownload: queueRes.status === 'fulfilled',
        disks:
          diskRes.status === 'fulfilled' && Array.isArray(diskRes.value)
            ? mapDiskSpace(diskRes.value)
            : [],
      };
    }),
  );

  return {
    agg: {
      total: per.reduce((sum, p) => sum + p.count, 0),
      downloads: per.reduce((sum, p) => sum + p.downloads, 0),
      hasDownload: per.some((p) => p.hasDownload),
      disks: per.flatMap((p) => p.disks),
    },
    complete,
  };
}

// Cached + deduped read of one *arr slice. Only a COMPLETE, non-null slice is
// written, so a partial fan-out is never pinned for the TTL.
async function getArrSliceCached<C extends StatClient>(
  seed: string,
  getClients: () => Promise<Array<{ client: C }>>,
  getCount: (client: C) => Promise<number>,
): Promise<ArrAgg | null> {
  const cached = await getCachedJson<ArrAgg>(STATS_CACHE_SCOPE, seed);
  if (cached) return cached;

  const existing = inflightArr.get(seed);
  if (existing) return existing;

  const promise = (async () => {
    const { agg, complete } = await loadArrSlice(getClients, getCount);
    if (agg && complete) await setCachedJson(STATS_CACHE_SCOPE, seed, agg, STATS_CACHE_TTL_SECONDS);
    return agg;
  })().finally(() => inflightArr.delete(seed));
  inflightArr.set(seed, promise);
  return promise;
}

async function loadJellyfinSlice(): Promise<JellyfinSlice | null> {
  try {
    const jellyfin = await getJellyfinClient();
    const [counts, sessions] = await Promise.all([
      jellyfin.getItemCounts(),
      jellyfin.getActiveSessions(),
    ]);
    return {
      movieCount: counts.MovieCount,
      seriesCount: counts.SeriesCount,
      episodeCount: counts.EpisodeCount,
      activeStreams: sessions.length,
    };
  } catch {
    return null;
  }
}

// Jellyfin reads are all-or-nothing (one try/catch), so a non-null slice means
// every read succeeded and is safe to cache; null = unavailable/unconfigured → skip.
async function getJellyfinSliceCached(): Promise<JellyfinSlice | null> {
  const seed = 'jellyfin';
  const cached = await getCachedJson<JellyfinSlice>(STATS_CACHE_SCOPE, seed);
  if (cached) return cached;

  const existing = inflightJellyfin.get(seed);
  if (existing) return existing;

  const promise = (async () => {
    const slice = await loadJellyfinSlice();
    if (slice) await setCachedJson(STATS_CACHE_SCOPE, seed, slice, STATS_CACHE_TTL_SECONDS);
    return slice;
  })().finally(() => inflightJellyfin.delete(seed));
  inflightJellyfin.set(seed, promise);
  return promise;
}

async function getHandler() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  // Each service's stats are gated by the same view capability that gates its
  // health, so a member without the cap doesn't learn its counts/disk usage.
  // Gating runs per request (it decides WHICH slices to read); the slices
  // themselves are shared/cached across users since the raw upstream data is
  // identical, so the cache never serves a service to a user who lacks its cap.
  // All readable service types fan out concurrently.
  const [radarr, sonarr, lidarr, jellyfin] = await Promise.all([
    can(user, 'movies.view')
      ? getArrSliceCached('radarr', getRadarrClients, (c) => c.getMovies().then((m) => m.length))
      : null,
    can(user, 'series.view')
      ? getArrSliceCached('sonarr', getSonarrClients, (c) => c.getSeries().then((s) => s.length))
      : null,
    can(user, 'music.view')
      ? getArrSliceCached('lidarr', getLidarrClients, (c) => c.getArtists().then((a) => a.length))
      : null,
    can(user, 'jellyfin.view') ? getJellyfinSliceCached() : null,
  ]);

  const stats: ServicesStatsResponse = {};
  let activeDownloads = 0;
  let hasDownloadCount = false;
  // Counts + active downloads sum across all instances of a type; disk space is
  // unioned and deduped below. Merge in a fixed Radarr→Sonarr→Lidarr order so
  // disk-dedupe tie-breaking stays deterministic.
  const allDisks: DiskSpace[] = [];

  if (radarr) {
    stats.totalMovies = radarr.total;
    activeDownloads += radarr.downloads;
    if (radarr.hasDownload) hasDownloadCount = true;
    allDisks.push(...radarr.disks);
  }
  if (sonarr) {
    stats.totalSeries = sonarr.total;
    activeDownloads += sonarr.downloads;
    if (sonarr.hasDownload) hasDownloadCount = true;
    allDisks.push(...sonarr.disks);
  }
  if (lidarr) {
    stats.totalArtists = lidarr.total;
    activeDownloads += lidarr.downloads;
    if (lidarr.hasDownload) hasDownloadCount = true;
    allDisks.push(...lidarr.disks);
  }

  if (allDisks.length > 0) stats.diskSpace = dedupeDiskSpace(allDisks);
  if (hasDownloadCount) stats.activeDownloads = activeDownloads;
  if (jellyfin) stats.jellyfin = jellyfin;

  return NextResponse.json(stats);
}

export const GET = withApiLogging(getHandler, 'api/services/stats');
