import { NextResponse } from 'next/server';
import { getSonarrClient, getRadarrClient, getLidarrClient, getJellyfinClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import type { DiskSpace, ServicesStatsResponse } from '@/types/service-stats';
import { withApiLogging } from '@/lib/api-logger';

function mapDiskSpace(disks: Array<DiskSpace | null | undefined>): DiskSpace[] {
  return disks.filter((disk): disk is DiskSpace => Boolean(disk));
}

async function getHandler() {
  const authError = await requireAuth();
  if (authError) return authError;

  const stats: ServicesStatsResponse = {};
  let activeDownloads = 0;
  let hasDownloadCount = false;

  // Fetch Radarr stats
  try {
    const radarr = await getRadarrClient();
    const movies = await radarr.getMovies();
    stats.totalMovies = movies.length;

    const queue = await radarr.getQueue(1, 1);
    activeDownloads += queue.totalRecords ?? 0;
    hasDownloadCount = true;

    const diskSpace = await radarr.getDiskSpace();
    if (Array.isArray(diskSpace)) {
      stats.diskSpace = mapDiskSpace(diskSpace);
    }
  } catch {}

  // Fetch Sonarr stats
  try {
    const sonarr = await getSonarrClient();
    const series = await sonarr.getSeries();
    stats.totalSeries = series.length;

    const queue = await sonarr.getQueue(1, 1);
    activeDownloads += queue.totalRecords ?? 0;
    hasDownloadCount = true;

    if (!stats.diskSpace) {
      const diskSpace = await sonarr.getDiskSpace();
      if (Array.isArray(diskSpace)) {
        stats.diskSpace = mapDiskSpace(diskSpace);
      }
    }
  } catch {}

  // Fetch Lidarr stats
  try {
    const lidarr = await getLidarrClient();
    const artists = await lidarr.getArtists();
    stats.totalArtists = artists.length;

    const queue = await lidarr.getQueue(1, 1);
    activeDownloads += queue.totalRecords ?? 0;
    hasDownloadCount = true;

    if (!stats.diskSpace) {
      const diskSpace = await lidarr.getDiskSpace();
      if (Array.isArray(diskSpace)) {
        stats.diskSpace = mapDiskSpace(diskSpace);
      }
    }
  } catch {}

  if (hasDownloadCount) {
    stats.activeDownloads = activeDownloads;
  }

  // Fetch Jellyfin stats
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

  return NextResponse.json(stats);
}

export const GET = withApiLogging(getHandler, 'api/services/stats');
