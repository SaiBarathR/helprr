import type { ManualDownload, ManualDownloadStatus } from '@prisma/client';

/** A manual download as the browser sees it: no request ids, no user ids, never a magnet. */
export function serializeManualDownload(download: ManualDownload & { events?: Array<{ at: Date; status: ManualDownloadStatus; message: string | null }> }) {
  return {
    id: download.id,
    mode: download.mode,
    status: download.status,
    service: download.service,
    instanceId: download.instanceId,
    instanceLabel: download.instanceLabel,
    externalId: download.externalId,
    arrItemId: download.arrItemId,
    arrItemTitle: download.arrItemTitle,
    createdArrItem: download.createdArrItem,
    targetEpisodeIds: download.targetEpisodeIds,
    releaseTitle: download.releaseTitle,
    source: download.source,
    infoHash: download.infoHash,
    torrentName: download.torrentName,
    downloadClientName: download.downloadClientName,
    lastError: download.lastError,
    attempts: download.attempts,
    createdByUsername: download.createdByUsername,
    createdAt: download.createdAt.toISOString(),
    updatedAt: download.updatedAt.toISOString(),
    completedAt: download.completedAt?.toISOString() ?? null,
    ...(download.events ? { events: download.events.map((event) => ({ at: event.at.toISOString(), status: event.status, message: event.message })) } : {}),
  };
}

export type SerializedManualDownload = ReturnType<typeof serializeManualDownload>;
