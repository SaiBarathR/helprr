import type { ManualDownload } from '@prisma/client';
import { prisma } from '@/lib/db';
import { resolveConnection } from '@/lib/arr-instances';
import { runWithOperationAudit, type AuditActor } from '@/lib/file-audit';
import { bumpQueueCacheVersion, fetchAllQueueRecords } from '@/lib/activity-queue';
import { invalidateTaggedLibrary } from '@/lib/cache/tagged-library';
import type { RadarrClient } from '@/lib/radarr-client';
import type { SonarrClient } from '@/lib/sonarr-client';
import { arrClientFor, TERMINAL_STATUSES } from './preflight';

/**
 * Cancelling a manual download. Arr owns the download, so cancelling removes
 * it from that Arr instance's queue; what else goes is the caller's choice and
 * gated separately:
 *
 * - removeFromClient: the torrent and its data leave the download client too.
 *   Without a blocklist Arr writes no history for this, so it refuses pushes
 *   of the same title as a recent grab for 12 hours.
 * - blocklist: Arr refuses this release from now on.
 * - removeTitle: the title this download added (never one that was already
 *   there), only while it has no files.
 */
export interface CancelOptions {
  removeFromClient: boolean;
  blocklist: boolean;
  removeTitle: boolean;
}

// Arr lists a grab in its queue a few seconds after the push.
const QUEUE_WAIT_MS = 15_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const SENDING = ['PREFLIGHT', 'CREATING_MEDIA', 'SUBMITTING_RELEASE'];
/** History events after which a download is no longer in Arr's queue. */
const SETTLED_EVENTS = ['downloadFolderImported', 'downloadFailed', 'downloadIgnored'];

export class ManualDownloadCancelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManualDownloadCancelError';
  }
}

export async function cancelManualDownload(download: ManualDownload, options: CancelOptions, actor: AuditActor): Promise<string> {
  if ((TERMINAL_STATUSES as readonly string[]).includes(download.status)) {
    throw new ManualDownloadCancelError('This download has already finished.');
  }
  if (SENDING.includes(download.status)) {
    throw new ManualDownloadCancelError('This download is still being sent. Try again once it has been.');
  }
  if (!download.instanceId) throw new ManualDownloadCancelError(`${download.instanceLabel} no longer exists in Helprr.`);
  const service = download.service === 'RADARR' ? 'RADARR' : 'SONARR';
  const app = service === 'RADARR' ? 'Radarr' : 'Sonarr';
  const connection = await resolveConnection(service, download.instanceId);
  const client = arrClientFor(service, connection);
  const done: string[] = [];

  const listed = async () => (await fetchAllQueueRecords(client, true)).records
    .filter((record) => record.downloadId?.toUpperCase() === download.infoHash);
  let items = await listed();
  if (items.length === 0) {
    // Grabbed and not settled means it belongs in the queue: ask Arr to look, and wait.
    const history = await client.getHistory(1, 50, 'date', 'descending', { downloadId: download.infoHash });
    const grabbed = history.records.some((record) => record.eventType === 'grabbed');
    const settled = history.records.some((record) => SETTLED_EVENTS.includes(record.eventType));
    if (grabbed && !settled) {
      await client.refreshMonitoredDownloads().catch(() => null);
      for (const deadline = Date.now() + QUEUE_WAIT_MS; items.length === 0 && Date.now() < deadline;) {
        await sleep(1_500);
        items = await listed();
      }
      if (items.length === 0) {
        throw new ManualDownloadCancelError(`${app} has not listed this download in its queue yet, so nothing was changed. Try again in a moment.`);
      }
    }
  }
  // Removing one record with the client removes the whole torrent; without it, each record is ignored.
  const toRemove = options.removeFromClient ? items.slice(0, 1) : items;
  for (const item of toRemove) {
    await runWithOperationAudit({
      user: actor,
      service,
      instanceId: download.instanceId,
      operation: 'REMOVE_QUEUE',
      targetType: 'queue',
      targetId: item.id,
      targetTitle: download.arrItemTitle,
      itemCount: options.removeFromClient ? items.length : 1,
      filesDeleted: options.removeFromClient,
      details: { manualDownloadId: download.id, infoHash: download.infoHash, removeFromClient: options.removeFromClient, blocklist: options.blocklist },
    }, () => client.deleteQueueItem(item.id, { removeFromClient: options.removeFromClient, blocklist: options.blocklist }));
  }
  if (items.length > 0) {
    await bumpQueueCacheVersion();
    done.push(options.removeFromClient
      ? `removed from ${app}'s queue with the torrent and its data${options.blocklist ? ', and blocklisted' : ''}`
      : `removed from ${app}'s queue; the torrent stays in the download client${options.blocklist ? ', and the release is blocklisted' : ''}`);
  } else {
    done.push(`not in ${app}'s queue any more`);
  }

  if (options.removeTitle) {
    if (!download.createdArrItem || !download.arrItemId) {
      done.push(`${download.arrItemTitle} was already in ${download.instanceLabel}, so it stays`);
    } else {
      const hasFiles = service === 'RADARR'
        ? (await (client as RadarrClient).getMovieFiles(download.arrItemId)).length > 0
        : (await (client as SonarrClient).getEpisodeFiles(download.arrItemId)).length > 0;
      if (hasFiles) {
        done.push(`${download.arrItemTitle} has files now, so it stays`);
      } else {
        await runWithOperationAudit({
          user: actor,
          service,
          instanceId: download.instanceId,
          operation: 'DELETE_MEDIA',
          targetType: service === 'RADARR' ? 'movie' : 'series',
          targetId: download.arrItemId,
          targetTitle: download.arrItemTitle,
          itemCount: 1,
          filesDeleted: false,
          details: { manualDownloadId: download.id, reason: 'manual download cancelled' },
        }, () => (service === 'RADARR'
          ? (client as RadarrClient).deleteMovie(download.arrItemId!, false, false)
          : (client as SonarrClient).deleteSeries(download.arrItemId!, false)));
        void invalidateTaggedLibrary(service === 'RADARR' ? 'radarr' : 'sonarr', download.instanceId).catch(() => {});
        done.push(`${download.arrItemTitle}, which this download had added, was removed`);
      }
    }
  }

  const message = `Cancelled: ${done.join('; ')}.`;
  await prisma.manualDownload.update({
    where: { id: download.id },
    data: { status: 'CANCELLED', completedAt: new Date(), events: { create: { status: 'CANCELLED', message } } },
  });
  return message;
}
