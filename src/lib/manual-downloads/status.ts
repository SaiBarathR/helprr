import { Prisma, type ManualDownload, type ManualDownloadStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { resolveConnection } from '@/lib/arr-instances';
import { fetchAllQueueRecords } from '@/lib/activity-queue';
import { noteJobFailure, noteJobSkipped } from '@/lib/polling-job-report';
import type { RadarrClient } from '@/lib/radarr-client';
import type { SonarrClient } from '@/lib/sonarr-client';
import type { HistoryItem, QueueItem } from '@/types';
import { arrClientFor, TERMINAL_STATUSES } from './preflight';

/**
 * Following manual downloads after the grab. Arr owns them, so Arr is the
 * authority: each instance's queue while the download is there, then its
 * history, and the title's file records for the import. Every open workflow
 * is reconciled on each run from that state, so a restart loses nothing.
 * IMPORTED means the target has file ids it did not have before the grab;
 * "the command completed" or "the title has a file" are not proof.
 */

/** How long a send may sit in an early state before it counts as interrupted (a restart mid-send). */
const INTERRUPTED_AFTER_MS = 10 * 60_000;
/** A grab missing from the queue right after the push is normal for a few seconds. */
const QUEUE_GRACE_MS = 2 * 60_000;
const SENDING: ManualDownloadStatus[] = ['PREFLIGHT', 'CREATING_MEDIA', 'SUBMITTING_RELEASE'];

type Outcome = { status: ManualDownloadStatus; message: string | null; data?: { arrQueueId?: number; importedFileIds?: number[] } };

function messagesOf(item: QueueItem): string {
  const lines = item.statusMessages?.flatMap((entry) => entry.messages ?? []) ?? [];
  return [...new Set([...lines, item.errorMessage].filter(Boolean))].join(' ');
}

/** What Arr's queue says about a download it lists. */
export function fromQueue(item: QueueItem, app: string): Outcome {
  const state = item.trackedDownloadState;
  const messages = messagesOf(item);
  if (state === 'importBlocked' || (state === 'importPending' && item.trackedDownloadStatus === 'warning')) {
    return { status: 'BLOCKED', message: `${app} cannot import it: ${messages || 'no reason given'}`, data: { arrQueueId: item.id } };
  }
  if (state === 'failedPending' || state === 'failed') {
    return { status: 'BLOCKED', message: `${app} marked the download failed: ${messages || 'no reason given'}`, data: { arrQueueId: item.id } };
  }
  if (state === 'importing') return { status: 'IMPORTING', message: `${app} is importing it.`, data: { arrQueueId: item.id } };
  if (state === 'importPending' || (state === 'downloading' && item.sizeleft === 0 && item.size > 0)) {
    return { status: 'IMPORT_PENDING', message: `Downloaded; waiting for ${app} to import it.`, data: { arrQueueId: item.id } };
  }
  return {
    status: 'DOWNLOADING',
    message: item.trackedDownloadStatus === 'warning' && messages ? `Downloading: ${messages}` : 'Downloading.',
    data: { arrQueueId: item.id },
  };
}

/** The target's file ids now, in the shape the baseline was taken in. */
async function currentFiles(download: ManualDownload, client: RadarrClient | SonarrClient): Promise<number[] | Record<string, number>> {
  if (download.service === 'RADARR') {
    return (await (client as RadarrClient).getMovieFiles(download.arrItemId!)).map((file) => file.id);
  }
  const episodes = await (client as SonarrClient).getEpisodes(download.arrItemId!);
  return Object.fromEntries(
    episodes.filter((episode) => download.targetEpisodeIds.includes(episode.id)).map((episode) => [String(episode.id), episode.episodeFileId ?? 0]),
  );
}

/**
 * Whether the import is proved: Radarr, a movie file id not in the baseline;
 * Sonarr, every target episode now holds a file id it did not hold before.
 */
export function importProof(download: Pick<ManualDownload, 'service' | 'baselineFileIds' | 'targetEpisodeIds'>, now: number[] | Record<string, number>): { proved: boolean; newFiles: number[]; missing: number[] } {
  if (download.service === 'RADARR') {
    const before = new Set((download.baselineFileIds as number[] | null) ?? []);
    const newFiles = (now as number[]).filter((id) => !before.has(id));
    return { proved: newFiles.length > 0, newFiles, missing: [] };
  }
  const before = (download.baselineFileIds as Record<string, number> | null) ?? {};
  const after = now as Record<string, number>;
  const newFiles: number[] = [];
  const missing: number[] = [];
  for (const episodeId of download.targetEpisodeIds) {
    const file = after[String(episodeId)] ?? 0;
    if (file > 0 && file !== (before[String(episodeId)] ?? 0)) newFiles.push(file);
    else missing.push(episodeId);
  }
  return { proved: download.targetEpisodeIds.length > 0 && missing.length === 0, newFiles: [...new Set(newFiles)], missing };
}

async function fromHistory(download: ManualDownload, client: RadarrClient | SonarrClient, app: string): Promise<Outcome | null> {
  const history = await client.getHistory(1, 50, 'date', 'descending', { downloadId: download.infoHash });
  const events = history.records;
  const has = (type: string) => events.some((record: HistoryItem) => record.eventType === type);
  if (has('downloadFolderImported') && download.arrItemId) {
    const proof = importProof(download, await currentFiles(download, client));
    if (proof.proved) {
      return { status: 'IMPORTED', message: `${app} imported it.`, data: { importedFileIds: proof.newFiles } };
    }
    return {
      status: 'BLOCKED',
      message: download.service === 'RADARR'
        ? `${app} reports an import, but ${download.arrItemTitle} has no new file.`
        : `${app} imported part of it, but ${proof.missing.length} of the episodes it covers have no new file.`,
    };
  }
  if (has('downloadFailed')) {
    const reason = events.find((record) => record.eventType === 'downloadFailed')?.data?.message;
    return { status: 'FAILED', message: `${app} marked the download failed${reason ? `: ${reason}` : '.'}` };
  }
  if (has('downloadIgnored')) return { status: 'CANCELLED', message: `The download was ignored in ${app}.` };
  if (has('grabbed')) {
    if (Date.now() - download.updatedAt.getTime() < QUEUE_GRACE_MS) return null;
    return { status: 'BLOCKED', message: `${app} no longer lists the download in its queue, and it was not imported. It may have been removed outside Helprr.` };
  }
  return { status: 'BLOCKED', message: `${app} has no record of this download any more.` };
}

const isError = (status: ManualDownloadStatus) => status === 'BLOCKED' || status === 'FAILED';

async function apply(download: ManualDownload, outcome: Outcome): Promise<void> {
  // A new event only when the status changes, or when a problem's reason does.
  const same = outcome.status === download.status && (!isError(outcome.status) || outcome.message === download.lastError);
  if (same && (outcome.data?.arrQueueId === undefined || outcome.data.arrQueueId === download.arrQueueId)) return;
  const terminal = (TERMINAL_STATUSES as readonly string[]).includes(outcome.status);
  try {
    // Only from the status read at the start of the run: a cancel that landed meanwhile wins.
    await prisma.manualDownload.update({
      where: { id: download.id, status: download.status },
      data: same ? { arrQueueId: outcome.data!.arrQueueId } : {
        ...(outcome.data ?? {}),
        status: outcome.status,
        lastError: isError(outcome.status) ? outcome.message : null,
        ...(terminal ? { completedAt: new Date() } : {}),
        events: { create: { status: outcome.status, message: outcome.message } },
      },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')) throw error;
  }
}

/** A send interrupted before it finished (the app restarted mid-send): settle it from Arr's history. */
async function settleInterrupted(download: ManualDownload, client: RadarrClient | SonarrClient, app: string): Promise<Outcome> {
  const history = await client.getHistory(1, 50, 'date', 'descending', { downloadId: download.infoHash, eventType: 1 });
  if (history.records.length > 0) return { status: 'QUEUED', message: `${app} had grabbed the release before the send was interrupted.` };
  const added = download.createdArrItem && download.arrItemId
    ? ` ${download.arrItemTitle} was added to ${download.instanceLabel} for it; remove it in ${app} if you do not want it.`
    : '';
  return { status: 'FAILED', message: `The send was interrupted before ${app} grabbed the release.${added}` };
}

/** Reconcile every open manual download against its own Arr instance. */
export async function reconcileManualDownloads(): Promise<void> {
  const open = await prisma.manualDownload.findMany({
    where: { status: { notIn: [...TERMINAL_STATUSES] }, mode: 'ARR_MANAGED' },
    orderBy: { createdAt: 'asc' },
  });
  const active = open.filter((download) => !SENDING.includes(download.status) || Date.now() - download.updatedAt.getTime() > INTERRUPTED_AFTER_MS);
  if (active.length === 0) {
    noteJobSkipped();
    return;
  }

  const byInstance = new Map<string, ManualDownload[]>();
  for (const download of active) {
    if (!download.instanceId) {
      await apply(download, { status: 'FAILED', message: `${download.instanceLabel} was removed from Helprr, so this download can no longer be followed.` });
      continue;
    }
    byInstance.set(download.instanceId, [...(byInstance.get(download.instanceId) ?? []), download]);
  }

  for (const [instanceId, downloads] of byInstance) {
    const service = downloads[0].service === 'RADARR' ? 'RADARR' : 'SONARR';
    const app = service === 'RADARR' ? 'Radarr' : 'Sonarr';
    try {
      const client = arrClientFor(service, await resolveConnection(service, instanceId));
      const queue = (await fetchAllQueueRecords(client, true)).records;
      for (const download of downloads) {
        try {
          if (SENDING.includes(download.status)) {
            await apply(download, await settleInterrupted(download, client, app));
            continue;
          }
          const item = queue.find((record) => record.downloadId?.toUpperCase() === download.infoHash);
          // Arr keeps an imported or ignored item listed for a while; its history settles it.
          const done = !item || item.trackedDownloadState === 'imported' || item.trackedDownloadState === 'ignored';
          const outcome = done ? await fromHistory(download, client, app) : fromQueue(item, app);
          if (outcome) await apply(download, outcome);
        } catch (error) {
          noteJobFailure(error);
        }
      }
    } catch (error) {
      // One instance down must not stop the others; its downloads keep their state.
      noteJobFailure(error);
    }
  }
}
