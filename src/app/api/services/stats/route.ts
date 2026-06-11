import { NextResponse } from 'next/server';
import { getSonarrClients, getRadarrClients, getLidarrClients, getJellyfinClient } from '@/lib/service-helpers';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import type { DiskSpace, ServicesStatsResponse } from '@/types/service-stats';
import { withApiLogging } from '@/lib/api-logger';

function mapDiskSpace(disks: Array<DiskSpace | null | undefined>): DiskSpace[] {
  return disks.filter((disk): disk is DiskSpace => Boolean(disk));
}

// Instances often share storage, so the same path can come back from several;
// dedupe by path (first wins) when merging disk space across instances.
function dedupeDiskSpace(disks: DiskSpace[]): DiskSpace[] {
  const byPath = new Map<string, DiskSpace>();
  for (const disk of disks) if (!byPath.has(disk.path)) byPath.set(disk.path, disk);
  return [...byPath.values()];
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
