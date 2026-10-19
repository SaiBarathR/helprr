import type { ManualDownload } from '@prisma/client';
import axios from 'axios';
import { prisma } from '@/lib/db';
import { resolveConnection } from '@/lib/arr-instances';
import { runWithOperationAudit, snapshotTorrentDeleteTargets, type AuditActor } from '@/lib/file-audit';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { bumpQueueCacheVersion, fetchAllQueueRecords } from '@/lib/activity-queue';
import { invalidateTaggedLibrary } from '@/lib/cache/tagged-library';
import type { RadarrClient } from '@/lib/radarr-client';
import type { SonarrClient } from '@/lib/sonarr-client';
import { arrClientFor, SENDING_STATUSES, TERMINAL_STATUSES } from './preflight';
import { titleInUse } from './title-use';
import { claimFallback, releaseClaim, type FallbackClaim } from './fallback';
import { redactUpstreamText } from './redact';

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
/** An older grab missing from the queue was removed outside Helprr (the status worker's grace too). */
const FRESH_GRAB_MS = 2 * 60_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
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
  if ((SENDING_STATUSES as readonly string[]).includes(download.status)) {
    throw new ManualDownloadCancelError('This download is still being sent. Try again once it has been.');
  }
  if (!download.instanceId) throw new ManualDownloadCancelError(`${download.instanceLabel} no longer exists in Helprr.`);
  if (download.mode !== 'QBIT_REVIEWED') return cancelSteps(download, options, actor, null);

  const app = download.service === 'RADARR' ? 'Radarr' : 'Sonarr';
  if (download.status === 'IMPORTING') throw new ManualDownloadCancelError(`${app} is importing it. Try again once it has finished.`);
  if (download.status === 'IMPORT_PENDING') throw new ManualDownloadCancelError('Helprr is reading or importing the files. Try again in a moment.');
  // A cancel takes the download like a scan or an import does, so none of them runs while it is cancelled.
  const claim = await claimFallback(download, 'Cancelling.');
  if (!claim) throw new ManualDownloadCancelError('This download changed meanwhile. Look at it again, then cancel.');
  try {
    return await cancelSteps(download, options, actor, claim);
  } catch (error) {
    // Back as it was, so it can be cancelled again.
    await releaseClaim(claim, download.status, `Cancelling did not finish: ${redactUpstreamText(error instanceof Error ? error.message : String(error))}`, { lastError: download.lastError }).catch(() => false);
    throw error;
  }
}

/** What cancelling does; under a claim for a fallback download, whose final write needs it still held. */
async function cancelSteps(download: ManualDownload, options: CancelOptions, actor: AuditActor, claim: FallbackClaim | null): Promise<string> {
  const service = download.service === 'RADARR' ? 'RADARR' : 'SONARR';
  const app = service === 'RADARR' ? 'Radarr' : 'Sonarr';
  const connection = await resolveConnection(service, download.instanceId!);
  const client = arrClientFor(service, connection);
  const done: string[] = [];

  if (download.mode === 'QBIT_REVIEWED') {
    // The torrent is Helprr's own in qBittorrent; Arr's queue never had it.
    if (options.removeFromClient) {
      const qbit = await getQBittorrentClient();
      const hash = download.infoHash.toLowerCase();
      const present = (await qbit.getTorrents(undefined, undefined, undefined, undefined, hash)).length > 0;
      if (present) {
        const snapshot = await snapshotTorrentDeleteTargets(qbit, hash);
        await runWithOperationAudit({
          user: actor,
          service: 'QBITTORRENT',
          operation: 'DELETE_TORRENT',
          targetType: 'torrent',
          targetTitle: snapshot.targetTitle,
          itemCount: snapshot.itemCount,
          filesDeleted: true,
          details: { ...snapshot.details, deleteFiles: true, manualDownloadId: download.id },
        }, () => qbit.deleteTorrent(hash, true));
        done.push('removed the torrent and its data from qBittorrent');
      } else {
        done.push('the torrent is not in qBittorrent any more');
      }
    } else {
      done.push('the torrent stays in qBittorrent');
    }
  } else {
    const listed = async () => (await fetchAllQueueRecords(client, true)).records
      .filter((record) => record.downloadId?.toUpperCase() === download.infoHash);
    let items = await listed();
    if (items.length === 0) {
      // A fresh grab not yet settled belongs in the queue: ask Arr to look, and wait.
      const history = await client.getHistory(1, 1000, 'date', 'descending', { downloadId: download.infoHash });
      const grab = history.records.find((record) => record.eventType === 'grabbed');
      const settled = history.records.some((record) => SETTLED_EVENTS.includes(record.eventType));
      // An unknown grab time counts as fresh.
      const fresh = grab !== undefined && !(Date.now() - Date.parse(grab.date) >= FRESH_GRAB_MS);
      if (fresh && !settled) {
        await client.refreshMonitoredDownloads().catch(() => null);
        for (const deadline = Date.now() + QUEUE_WAIT_MS; items.length === 0 && Date.now() < deadline;) {
          await sleep(1_500);
          items = await listed();
        }
        if (items.length === 0) {
          throw new ManualDownloadCancelError(`${app} has not listed this download in its queue yet, so nothing was changed. Try again in a moment.`);
        }
      }
      // A send whose answer was lost: Arr may still be taking the release.
      if (!grab && Date.now() - download.updatedAt.getTime() < FRESH_GRAB_MS) {
        throw new ManualDownloadCancelError(`${app} may still be taking this release, so nothing was changed. Try again in a couple of minutes.`);
      }
    }
    // Removing one record with the client removes the whole torrent; without it, each record is ignored.
    // A blocklisted removal counts as a failed download in Arr: skipRedownload keeps Arr from searching for another release.
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
      }, () => client.deleteQueueItem(item.id, { removeFromClient: options.removeFromClient, blocklist: options.blocklist, skipRedownload: true }));
    }
    if (items.length > 0) {
      await bumpQueueCacheVersion();
      done.push(options.removeFromClient
        ? `removed from ${app}'s queue with the torrent and its data${options.blocklist ? ', and blocklisted' : ''}`
        : `removed from ${app}'s queue; the torrent stays in the download client${options.blocklist ? ', and the release is blocklisted' : ''}`);
    } else {
      done.push(`not in ${app}'s queue any more`);
    }
  }

  if (options.removeTitle) {
    if (!download.createdArrItem || !download.arrItemId) {
      done.push(`${download.arrItemTitle} was already in ${download.instanceLabel}, so it stays`);
    } else {
      try {
        const hasFiles = service === 'RADARR'
          ? (await (client as RadarrClient).getMovieFiles(download.arrItemId)).length > 0
          : (await (client as SonarrClient).getEpisodeFiles(download.arrItemId)).length > 0;
        if (hasFiles) {
          done.push(`${download.arrItemTitle} has files now, so it stays`);
        } else if (await titleInUse(download, client)) {
          done.push(`another download is on its way for ${download.arrItemTitle}, so it stays`);
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
          void invalidateTaggedLibrary(service === 'RADARR' ? 'radarr' : 'sonarr', connection.id).catch(() => {});
          done.push(`${download.arrItemTitle}, which this download had added, was removed`);
        }
      } catch (error) {
        // Removed in Arr already.
        if (!(axios.isAxiosError(error) && error.response?.status === 404)) throw error;
        done.push(`${download.arrItemTitle} is no longer in ${download.instanceLabel}`);
      }
    }
  }

  const message = `Cancelled: ${done.join('; ')}.`;
  if (claim) {
    if (!(await releaseClaim(claim, 'CANCELLED', message))) throw new ManualDownloadCancelError('This download changed meanwhile. Look at it again.');
    return message;
  }
  await prisma.manualDownload.update({
    where: { id: download.id },
    data: { status: 'CANCELLED', completedAt: new Date(), events: { create: { status: 'CANCELLED', message } } },
  });
  return message;
}
