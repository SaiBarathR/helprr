import { Prisma, type ManualDownload, type ManualDownloadStatus } from '@prisma/client';
import axios from 'axios';
import { prisma } from '@/lib/db';
import { resolveConnection } from '@/lib/arr-instances';
import { fetchAllQueueRecords } from '@/lib/activity-queue';
import { noteJobFailure, noteJobSkipped } from '@/lib/polling-job-report';
import { getQBittorrentClient } from '@/lib/service-helpers';
import type { RadarrClient } from '@/lib/radarr-client';
import type { SonarrClient } from '@/lib/sonarr-client';
import type { HistoryItem, QBittorrentTorrent, QueueItem } from '@/types';
import { arrClientFor, TERMINAL_STATUSES } from './preflight';
import { settleDownloaded } from './fallback';

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

const isError = (status: ManualDownloadStatus) => status === 'BLOCKED' || status === 'FAILED' || status === 'NEEDS_MAPPING';

export async function apply(download: ManualDownload, outcome: Outcome): Promise<void> {
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

// qBittorrent states in which the files are not settled on disk yet.
const BUSY = new Set(['moving', 'checkingUP', 'checkingDL', 'checkingResumeData', 'metaDL', 'forcedMetaDL']);

/** A fallback import Helprr started: proved by new file ids, or failed as Arr's command says. */
async function followImport(download: ManualDownload, client: RadarrClient | SonarrClient, app: string): Promise<Outcome | null> {
  const proof = importProof(download, await currentFiles(download, client));
  if (proof.proved) return { status: 'IMPORTED', message: `${app} imported it.`, data: { importedFileIds: proof.newFiles } };
  if (!download.arrCommandId) return null;
  let command;
  try {
    command = await client.getCommand(download.arrCommandId);
  } catch (error) {
    if (!(axios.isAxiosError(error) && error.response?.status === 404)) throw error;
    return { status: 'BLOCKED', message: `${app} no longer knows the import, and ${download.arrItemTitle} has no new file. Import again.` };
  }
  if (command.status === 'failed' || command.status === 'aborted' || command.status === 'cancelled') {
    return { status: 'BLOCKED', message: `${app}'s import failed: ${command.message || 'no reason given'}. Fix it, then import again.` };
  }
  if (command.status === 'completed') {
    const which = download.service === 'SONARR' && proof.missing.length > 0 ? ` for ${proof.missing.length} of the episodes` : '';
    return { status: 'BLOCKED', message: `${app} finished the import, but ${download.arrItemTitle} has no new file${which}. Check ${app}'s logs, then import again.` };
  }
  return null;
}

/**
 * A fallback download: qBittorrent until the chosen files are complete, then
 * Arr's reading of them (settleDownloaded), then the import. NEEDS_MAPPING and
 * BLOCKED wait for the user (import, scan again, or cancel).
 */
async function fromFallback(download: ManualDownload, client: RadarrClient | SonarrClient, app: string, torrent: QBittorrentTorrent | undefined): Promise<Outcome | null> {
  if (download.status === 'IMPORTING') return followImport(download, client, app);
  if (download.status === 'NEEDS_MAPPING' || download.status === 'BLOCKED') return null;
  // A scan or import is under way; one taking longer than this was interrupted and runs again.
  if (download.status === 'IMPORT_PENDING' && Date.now() - download.updatedAt.getTime() < INTERRUPTED_AFTER_MS) return null;
  if (!torrent) return { status: 'BLOCKED', message: 'The torrent is no longer in qBittorrent.' };
  if (torrent.progress < 1 || BUSY.has(torrent.state)) return { status: 'DOWNLOADING', message: 'Downloading.' };
  // Records its own outcome.
  await settleDownloaded(download, client, torrent.save_path);
  return null;
}

/** Reconcile every open manual download against its own Arr instance. */
export async function reconcileManualDownloads(): Promise<void> {
  const open = await prisma.manualDownload.findMany({
    where: { status: { notIn: [...TERMINAL_STATUSES] } },
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

  // Fallback downloads live in Helprr's qBittorrent: one look for all of them.
  const fallbackHashes = active.filter((download) => download.mode === 'QBIT_REVIEWED').map((download) => download.infoHash.toLowerCase());
  let torrents: QBittorrentTorrent[] | null = null;
  if (fallbackHashes.length > 0) {
    try {
      torrents = await (await getQBittorrentClient()).getTorrents(undefined, undefined, undefined, undefined, fallbackHashes.join('|'));
    } catch (error) {
      noteJobFailure(error);
    }
  }

  for (const [instanceId, downloads] of byInstance) {
    const service = downloads[0].service === 'RADARR' ? 'RADARR' : 'SONARR';
    const app = service === 'RADARR' ? 'Radarr' : 'Sonarr';
    try {
      const client = arrClientFor(service, await resolveConnection(service, instanceId));
      const queue = downloads.some((download) => download.mode === 'ARR_MANAGED') ? (await fetchAllQueueRecords(client, true)).records : [];
      for (const download of downloads) {
        try {
          if (SENDING.includes(download.status)) {
            await apply(download, download.mode === 'ARR_MANAGED'
              ? await settleInterrupted(download, client, app)
              : { status: 'FAILED', message: `Starting the download was interrupted.${download.createdArrItem ? ` ${download.arrItemTitle} was added to ${download.instanceLabel} for it; remove it in ${app} if you do not want it.` : ''} Start it again from Add Torrent.` });
            continue;
          }
          if (download.mode === 'QBIT_REVIEWED') {
            // Without an answer from qBittorrent the state is unknown: leave it.
            if (!torrents) continue;
            const outcome = await fromFallback(download, client, app, torrents.find((torrent) => torrent.hash.toUpperCase() === download.infoHash));
            if (outcome) await apply(download, outcome);
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
