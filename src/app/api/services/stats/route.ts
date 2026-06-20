import { NextResponse } from 'next/server';
import { getSonarrClients, getRadarrClients, getLidarrClients, getJellyfinClient } from '@/lib/service-helpers';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import type { DiskSpace, ServicesStatsResponse } from '@/types/service-stats';
import { withApiLogging } from '@/lib/api-logger';

function mapDiskSpace(disks: Array<DiskSpace | null | undefined>): DiskSpace[] {
  return disks.filter((disk): disk is DiskSpace => Boolean(disk));
}

// Instances share storage AND containers see the same filesystem under
// different mounts (/ vs /config, /mnt/disk vs /data vs a root-folder
// subpath), so path alone can't dedupe — one physical drive showed up as
// three "disks". Two entries are the same filesystem when totals match
// exactly and free space agrees within a tolerance (services sample free
// space moments apart, so it drifts slightly during writes).
const FREE_SPACE_TOLERANCE = 512 * 1024 ** 2; // 512 MiB

function sameFilesystem(a: DiskSpace, b: DiskSpace): boolean {
  // Two distinct device labels (uuids) are different filesystems regardless of size —
  // never merge them, so two same-size drives don't collapse on a coincidental match.
  // When either label is missing fall back to the size + free-space heuristic.
  if (a.label && b.label && a.label !== b.label) return false;
  return a.totalSpace === b.totalSpace && Math.abs(a.freeSpace - b.freeSpace) <= FREE_SPACE_TOLERANCE;
}

// Keep the most identifiable entry: a real device label (uuid) first, then
// the shortest path (a host-style mount beats a container subpath).
function preferDisk(a: DiskSpace, b: DiskSpace): DiskSpace {
  const aHasLabel = Boolean(a.label);
  const bHasLabel = Boolean(b.label);
  if (aHasLabel !== bHasLabel) return aHasLabel ? a : b;
  return a.path.length <= b.path.length ? a : b;
}

function dedupeDiskSpace(disks: DiskSpace[]): DiskSpace[] {
  const out: DiskSpace[] = [];
  for (const disk of disks) {
    const matchIdx = out.findIndex((kept) => sameFilesystem(kept, disk));
    if (matchIdx === -1) out.push(disk);
    else out[matchIdx] = preferDisk(out[matchIdx], disk);
  }
  return out;
}

type ArrAgg = { total: number; downloads: number; hasDownload: boolean; disks: DiskSpace[] };

type StatClient = {
  getQueue(page: number, pageSize: number): Promise<{ totalRecords: number }>;
  getDiskSpace(): Promise<DiskSpace[]>;
};

// One service type, summed across its instances. Per instance the 3 reads
// (count, queue, disk) are independent and fan out together; across instances
// they fan out too. Returns null when the user can't view this service or none
// is configured, so the caller leaves the count stat unset (vs. 0).
async function collectArr<C extends StatClient>(
  enabled: boolean,
  getClients: () => Promise<Array<{ client: C }>>,
  getCount: (client: C) => Promise<number>,
): Promise<ArrAgg | null> {
  if (!enabled) return null;
  let instances: Array<{ client: C }>;
  try {
    instances = await getClients();
  } catch {
    return null;
  }
  if (instances.length === 0) return null;

  const per = await Promise.all(
    instances.map(async ({ client }) => {
      // Settle each read independently so one failing call (e.g. disk) doesn't
      // drop a sibling's data — matching the old per-call resilience.
      const [countRes, queueRes, diskRes] = await Promise.allSettled([
        getCount(client),
        client.getQueue(1, 1),
        client.getDiskSpace(),
      ]);
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
    total: per.reduce((sum, p) => sum + p.count, 0),
    downloads: per.reduce((sum, p) => sum + p.downloads, 0),
    hasDownload: per.some((p) => p.hasDownload),
    disks: per.flatMap((p) => p.disks),
  };
}

async function collectJellyfin(
  enabled: boolean,
): Promise<NonNullable<ServicesStatsResponse['jellyfin']> | null> {
  if (!enabled) return null;
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

async function getHandler() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  // Each service's stats are gated by the same view capability that gates its
  // health, so a member without the cap doesn't learn its counts/disk usage.
  // Aggregates (activeDownloads, diskSpace) only fold in services the user can
  // view. All service types fan out concurrently — they were previously awaited
  // one after another (≈3×N serial round-trips with N instances).
  const [radarr, sonarr, lidarr, jellyfin] = await Promise.all([
    collectArr(can(user, 'movies.view'), getRadarrClients, (c) => c.getMovies().then((m) => m.length)),
    collectArr(can(user, 'series.view'), getSonarrClients, (c) => c.getSeries().then((s) => s.length)),
    collectArr(can(user, 'music.view'), getLidarrClients, (c) => c.getArtists().then((a) => a.length)),
    collectJellyfin(can(user, 'jellyfin.view')),
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
