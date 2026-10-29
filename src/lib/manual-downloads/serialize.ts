import type { ManualDownload, ManualDownloadFile, ManualDownloadStatus } from '@prisma/client';

type StoredCandidate = {
  movie?: { id: number; title: string } | null;
  series?: { id: number; title: string } | null;
  episodes?: Array<{ id: number; seasonNumber: number; episodeNumber: number }>;
  quality?: { quality?: { name?: string } };
  languages?: Array<{ name?: string }>;
  releaseGroup?: string;
  rejections?: Array<{ reason: string }>;
};

/** A fallback file: where it is, and what Arr made of it (never Arr's whole payload). */
function serializeFile(file: ManualDownloadFile) {
  const candidate = file.candidate as StoredCandidate | null;
  return {
    id: file.id,
    fileIndex: file.fileIndex,
    path: file.path,
    size: Number(file.size),
    selected: file.selected,
    decision: file.decision,
    episodeIds: file.episodeIds,
    scanned: file.arrPath !== null,
    arr: candidate
      ? {
          movie: candidate.movie ?? null,
          series: candidate.series ?? null,
          episodes: candidate.episodes ?? [],
          quality: candidate.quality?.quality?.name ?? null,
          languages: (candidate.languages ?? []).map((language) => language.name ?? '').filter(Boolean),
          releaseGroup: candidate.releaseGroup ?? null,
          rejections: (candidate.rejections ?? []).map((rejection) => rejection.reason),
        }
      : null,
  };
}

/** A manual download as the browser sees it: no request ids, no user ids, never a magnet. */
export function serializeManualDownload(download: ManualDownload & {
  events?: Array<{ at: Date; status: ManualDownloadStatus; message: string | null }>;
  files?: ManualDownloadFile[];
}) {
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
    importedFileCount: Array.isArray(download.importedFileIds) ? download.importedFileIds.length : null,
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
    ...(download.files ? { files: download.files.map(serializeFile) } : {}),
  };
}

export type SerializedManualDownload = ReturnType<typeof serializeManualDownload>;
