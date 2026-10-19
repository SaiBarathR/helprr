import { prisma } from '@/lib/db';
import { fetchAllQueueRecords } from '@/lib/activity-queue';
import type { RadarrClient } from '@/lib/radarr-client';
import type { SonarrClient } from '@/lib/sonarr-client';
import { TERMINAL_STATUSES } from './preflight';

/**
 * Whether a title a manual download added is still wanted by something else:
 * another open manual download for it on the same instance, or anything in
 * that instance's queue for it (another release, Helprr's or not). Removing
 * the title then would pull it out from under that download.
 */
export async function titleInUse(
  download: { id: string; service: string; instanceId: string | null; arrItemId: number | null; infoHash: string },
  client: RadarrClient | SonarrClient,
): Promise<boolean> {
  if (!download.instanceId || !download.arrItemId) return false;
  const others = await prisma.manualDownload.count({
    where: { id: { not: download.id }, instanceId: download.instanceId, arrItemId: download.arrItemId, status: { notIn: [...TERMINAL_STATUSES] } },
  });
  if (others > 0) return true;
  const queue = (await fetchAllQueueRecords(client, true)).records;
  return queue.some((item) => item.downloadId?.toUpperCase() !== download.infoHash
    && (download.service === 'RADARR' ? item.movieId === download.arrItemId : item.seriesId === download.arrItemId));
}
