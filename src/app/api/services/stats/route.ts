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

async function getHandler() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const stats: ServicesStatsResponse = {};
  let activeDownloads = 0;
  let hasDownloadCount = false;

  // Each service's stats are gated by the same view capability that gates its
  // health, so a member without the cap doesn't learn its counts/disk usage.
  // Aggregates (activeDownloads, diskSpace) only fold in services the user can view.

  // Per-instance: counts + active downloads sum across all instances of a type;
  // disk space is unioned across instances and deduped by path below.
  const allDisks: DiskSpace[] = [];

  // Fetch Radarr stats (summed across instances)
  if (can(user, 'movies.view')) {
    try {
      const instances = await getRadarrClients();
      if (instances.length > 0) {
        let total = 0;
        for (const { client } of instances) {
          try {
            total += (await client.getMovies()).length;
            activeDownloads += (await client.getQueue(1, 1)).totalRecords ?? 0;
            hasDownloadCount = true;
            const ds = await client.getDiskSpace();
            if (Array.isArray(ds)) allDisks.push(...mapDiskSpace(ds));
          } catch {}
        }
        stats.totalMovies = total;
      }
    } catch {}
  }

  // Fetch Sonarr stats (summed across instances)
  if (can(user, 'series.view')) {
    try {
      const instances = await getSonarrClients();
      if (instances.length > 0) {
        let total = 0;
        for (const { client } of instances) {
          try {
            total += (await client.getSeries()).length;
            activeDownloads += (await client.getQueue(1, 1)).totalRecords ?? 0;
            hasDownloadCount = true;
            const ds = await client.getDiskSpace();
            if (Array.isArray(ds)) allDisks.push(...mapDiskSpace(ds));
          } catch {}
        }
        stats.totalSeries = total;
      }
    } catch {}
  }

  // Fetch Lidarr stats (summed across instances)
  if (can(user, 'music.view')) {
    try {
      const instances = await getLidarrClients();
      if (instances.length > 0) {
        let total = 0;
        for (const { client } of instances) {
          try {
            total += (await client.getArtists()).length;
            activeDownloads += (await client.getQueue(1, 1)).totalRecords ?? 0;
            hasDownloadCount = true;
            const ds = await client.getDiskSpace();
            if (Array.isArray(ds)) allDisks.push(...mapDiskSpace(ds));
          } catch {}
        }
        stats.totalArtists = total;
      }
    } catch {}
  }

  if (allDisks.length > 0) {
    stats.diskSpace = dedupeDiskSpace(allDisks);
  }

  if (hasDownloadCount) {
    stats.activeDownloads = activeDownloads;
  }

  // Fetch Jellyfin stats
  if (can(user, 'jellyfin.view')) {
    try {
      const jellyfin = await getJellyfinClient();
      const [counts, sessions] = await Promise.all([
        jellyfin.getItemCounts(),
        jellyfin.getActiveSessions(),
      ]);
      stats.jellyfin = {
        movieCount: counts.MovieCount,
        seriesCount: counts.SeriesCount,
        episodeCount: counts.EpisodeCount,
        activeStreams: sessions.length,
      };
    } catch {}
  }

  return NextResponse.json(stats);
}

export const GET = withApiLogging(getHandler, 'api/services/stats');
