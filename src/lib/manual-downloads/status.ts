import { Prisma, type ManualDownload, type ManualDownloadStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { resolveConnection } from '@/lib/arr-instances';
import { fetchAllQueueRecords } from '@/lib/activity-queue';
import { noteJobFailure, noteJobSkipped } from '@/lib/polling-job-report';
import type { RadarrClient } from '@/lib/radarr-client';
import type { SonarrClient } from '@/lib/sonarr-client';
import type { HistoryItem, QueueItem } from '@/types';
import { arrClientFor, TERMINAL_STATUSES } from './preflight';
import { redactUpstreamText } from './redact';

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

type Outcome = {
  status: ManualDownloadStatus;
  message: string | null;
  data?: { arrQueueId?: number; importedFileIds?: number[]; targetEpisodeIds?: number[]; baselineFileIds?: Record<string, number> };
};

function messagesOf(item: QueueItem): string {
  const lines = item.statusMessages?.flatMap((entry) => entry.messages ?? []) ?? [];
  return redactUpstreamText([...new Set([...lines, item.errorMessage].filter(Boolean))].join(' '));
}

/** A queue entry for this release that Arr has for another title (or other episodes) than the workflow's. */
export function wrongTarget(download: Pick<ManualDownload, 'service' | 'arrItemId' | 'targetEpisodeIds'>, item: QueueItem): boolean {
  if (download.service === 'RADARR') return item.movieId !== undefined && item.movieId !== download.arrItemId;
  if (item.seriesId !== undefined && item.seriesId !== download.arrItemId) return true;
  return item.episodeId !== undefined && download.targetEpisodeIds.length > 0 && !download.targetEpisodeIds.includes(item.episodeId);
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

const fileIdOf = (event: HistoryItem) => Number(event.data?.fileId) || 0;

/**
 * Whether the import is proved. With this release's own import events (Arr
 * records the file each one imported): Radarr, an imported movie file that
 * the movie still has; Sonarr, every target episode holds the file this
 * release imported for it. Without them (Helprr's own fallback imports, which
 * have no download id): Radarr, a movie file id not in the baseline; Sonarr,
 * every target episode holds a file id it did not hold before.
 */
export function importProof(
  download: Pick<ManualDownload, 'service' | 'baselineFileIds' | 'targetEpisodeIds'> & { arrItemId?: number | null },
  now: number[] | Record<string, number>,
  imports: HistoryItem[] = [],
): { proved: boolean; newFiles: number[]; missing: number[] } {
  const recorded = imports.filter((event) => fileIdOf(event) > 0);
  if (recorded.length > 0) {
    if (download.service === 'RADARR') {
      const current = new Set(now as number[]);
      const newFiles = [...new Set(recorded.filter((event) => event.movieId === download.arrItemId).map(fileIdOf).filter((id) => current.has(id)))];
      return { proved: newFiles.length > 0, newFiles, missing: [] };
    }
    const after = now as Record<string, number>;
    const newFiles: number[] = [];
    const missing: number[] = [];
    for (const episodeId of download.targetEpisodeIds) {
      const file = after[String(episodeId)] ?? 0;
      if (file > 0 && recorded.some((event) => event.episodeId === episodeId && fileIdOf(event) === file)) newFiles.push(file);
      else missing.push(episodeId);
    }
    return { proved: download.targetEpisodeIds.length > 0 && missing.length === 0, newFiles: [...new Set(newFiles)], missing };
  }
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

const ENDINGS = ['downloadFolderImported', 'downloadFailed', 'downloadIgnored'];

async function fromHistory(download: ManualDownload, client: RadarrClient | SonarrClient, app: string): Promise<Outcome | null> {
  // This release's records only, newest first, so a season pack fits one page.
  const history = await client.getHistory(1, 1000, 'date', 'descending', { downloadId: download.infoHash });
  const events = history.records;
  const has = (type: string) => events.some((record: HistoryItem) => record.eventType === type);
  // The newest event that ends a download says how it ended: a failure after a
  // partial import is a failure.
  const ending = events.find((record) => ENDINGS.includes(record.eventType))?.eventType;
  if (ending === 'downloadFolderImported' && download.arrItemId) {
    const imports = events.filter((record) => record.eventType === 'downloadFolderImported');
    const proof = importProof(download, await currentFiles(download, client), imports);
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
  if (ending === 'downloadFailed') {
    const reason = events.find((record) => record.eventType === 'downloadFailed')?.data?.message;
    return { status: 'FAILED', message: `${app} marked the download failed${reason ? `: ${redactUpstreamText(reason)}` : '.'}` };
  }
  if (ending === 'downloadIgnored') return { status: 'CANCELLED', message: `The download was ignored in ${app}.` };
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
    // Only from the state read at the start of the run: a cancel (or another
    // poller) that wrote meanwhile wins.
    await prisma.manualDownload.update({
      where: { id: download.id, status: download.status, updatedAt: download.updatedAt },
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
  const history = await client.getHistory(1, 1000, 'date', 'descending', { downloadId: download.infoHash, eventType: 1 });
  const grabs = history.records;
  if (grabs.length > 0) {
    const named = (grab: HistoryItem) => (download.service === 'RADARR' ? grab.movieId : grab.seriesId);
    const wrong = grabs.some((grab) => named(grab) !== undefined && named(grab) !== download.arrItemId);
    if (wrong) return { status: 'BLOCKED', message: `${app} grabbed the release for a different title than ${download.arrItemTitle}. Cancel it from its queue.` };
    // Sonarr matched by TVDB id, and the send stopped before it took the episodes from the grab.
    if (download.service === 'SONARR' && download.targetEpisodeIds.length === 0) {
      const targetEpisodeIds = [...new Set(grabs.flatMap((grab) => (grab.episodeId !== undefined ? [grab.episodeId] : [])))];
      // No baseline from before the push survives the restart: the import is proved by its own events.
      return {
        status: 'QUEUED',
        message: `${app} had grabbed the release before the send was interrupted.`,
        data: { targetEpisodeIds, baselineFileIds: Object.fromEntries(targetEpisodeIds.map((episodeId) => [String(episodeId), 0])) },
      };
    }
    return { status: 'QUEUED', message: `${app} had grabbed the release before the send was interrupted.` };
  }
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
          const items = queue.filter((record) => record.downloadId?.toUpperCase() === download.infoHash);
          const item = items[0];
          // Arr keeps an imported or ignored item listed for a while; its history settles it.
          const done = !item || item.trackedDownloadState === 'imported' || item.trackedDownloadState === 'ignored';
          const outcome: Outcome | null = items.some((entry) => wrongTarget(download, entry))
            ? { status: 'BLOCKED', message: `${app} grabbed the release for a different title than ${download.arrItemTitle}. Cancel it from its queue.` }
            : done ? await fromHistory(download, client, app) : fromQueue(item, app);
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
