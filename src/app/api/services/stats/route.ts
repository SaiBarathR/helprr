import { NextResponse } from 'next/server';
import { getSonarrClient, getRadarrClient } from '@/lib/service-helpers';

interface StatsResponse {
  totalMovies?: number;
  totalSeries?: number;
  activeDownloads?: number;
  diskSpace?: { freeSpace: number; totalSpace: number }[];
}

export async function GET() {
  const stats: StatsResponse = {};
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
      stats.diskSpace = diskSpace.map((d) => ({
        freeSpace: d.freeSpace,
        totalSpace: d.totalSpace,
      }));
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
        stats.diskSpace = diskSpace.map((d) => ({
          freeSpace: d.freeSpace,
          totalSpace: d.totalSpace,
        }));
      }
    }
  } catch {}

  if (hasDownloadCount) {
    stats.activeDownloads = activeDownloads;
  }

  return NextResponse.json(stats);
}
