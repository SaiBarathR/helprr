import { NextResponse } from 'next/server';
import { getSonarrClient, getRadarrClient, getJellyfinClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import type { DiskSpace, ServicesStatsResponse } from '@/types/service-stats';

function mapDiskSpace(disks: Array<DiskSpace | null | undefined>): DiskSpace[] {
  return disks.filter((disk): disk is DiskSpace => Boolean(disk));
}

export async function GET() {
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
