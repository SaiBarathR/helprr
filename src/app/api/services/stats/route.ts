import { NextResponse } from 'next/server';
import { getSonarrClient, getRadarrClient, getLidarrClient, getJellyfinClient } from '@/lib/service-helpers';
import { requireUser } from '@/lib/auth';
import { can } from '@/lib/permissions';
import type { DiskSpace, ServicesStatsResponse } from '@/types/service-stats';
import { withApiLogging } from '@/lib/api-logger';

function mapDiskSpace(disks: Array<DiskSpace | null | undefined>): DiskSpace[] {
  return disks.filter((disk): disk is DiskSpace => Boolean(disk));
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

  // Fetch Radarr stats
  if (can(user, 'movies.view')) {
    try {
      const radarr = await getRadarrClient();
      const movies = await radarr.getMovies();
      stats.totalMovies = movies.length;

      const queue = await radarr.getQueue(1, 1);
      activeDownloads += queue.totalRecords ?? 0;
      hasDownloadCount = true;

      const diskSpace = await radarr.getDiskSpace();
      if (Array.isArray(diskSpace)) {
        const mapped = mapDiskSpace(diskSpace);
        if (mapped.length > 0) stats.diskSpace = mapped;
      }
    } catch {}
  }

  // Fetch Sonarr stats
  if (can(user, 'series.view')) {
    try {
      const sonarr = await getSonarrClient();
      const series = await sonarr.getSeries();
      stats.totalSeries = series.length;

      const queue = await sonarr.getQueue(1, 1);
      activeDownloads += queue.totalRecords ?? 0;
      hasDownloadCount = true;

      if (!stats.diskSpace?.length) {
        const diskSpace = await sonarr.getDiskSpace();
        if (Array.isArray(diskSpace)) {
          const mapped = mapDiskSpace(diskSpace);
          if (mapped.length > 0) stats.diskSpace = mapped;
        }
      }
    } catch {}
  }

  // Fetch Lidarr stats
  if (can(user, 'music.view')) {
    try {
      const lidarr = await getLidarrClient();
      const artists = await lidarr.getArtists();
      stats.totalArtists = artists.length;

      const queue = await lidarr.getQueue(1, 1);
      activeDownloads += queue.totalRecords ?? 0;
      hasDownloadCount = true;

      if (!stats.diskSpace?.length) {
        const diskSpace = await lidarr.getDiskSpace();
        if (Array.isArray(diskSpace)) {
          const mapped = mapDiskSpace(diskSpace);
          if (mapped.length > 0) stats.diskSpace = mapped;
        }
      }
    } catch {}
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
