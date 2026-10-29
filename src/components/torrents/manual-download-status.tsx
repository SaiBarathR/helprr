import type { ManualDownloadStatus } from '@prisma/client';
import type { SerializedManualDownload } from '@/lib/manual-downloads/serialize';
import type { DownloadProgress } from '@/lib/manual-downloads/progress';
import { formatBytes } from '@/lib/format';

/**
 * How a manual download's state reads in the UI: one label, a tone, where it
 * stands in the Sent → Downloading → Importing → Imported pipeline, and the
 * next step for the user. Shared by the list and the detail page.
 */

export type ManualDownloadView = SerializedManualDownload & { progress?: DownloadProgress | null };

export function DownloadProgressText({ download }: { download: ManualDownloadView }) {
  if (!['QUEUED', 'DOWNLOADING'].includes(download.status) || !download.progress) return null;
  const { fraction, size } = download.progress;
  const percent = fraction < 1 ? Math.min(99, Math.floor(fraction * 100)) : 100;
  return (
    <p className="text-xs text-muted-foreground tabular-nums">
      {percent}%{size !== null ? ` · ${formatBytes(size * fraction)} of ${formatBytes(size)}` : ''}
    </p>
  );
}

export const STATUS_LABEL: Record<ManualDownloadStatus, string> = {
  PREFLIGHT: 'Checking',
  CREATING_MEDIA: 'Adding title',
  SUBMITTING_RELEASE: 'Sending',
  QUEUED: 'Grabbed',
  DOWNLOADING: 'Downloading',
  IMPORT_PENDING: 'Waiting to import',
  IMPORTING: 'Importing',
  IMPORTED: 'Imported',
  NEEDS_MAPPING: 'Needs mapping',
  BLOCKED: 'Needs attention',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

export type StatusTone = 'progress' | 'done' | 'attention' | 'muted';

export function statusTone(status: ManualDownloadStatus): StatusTone {
  if (status === 'IMPORTED') return 'done';
  if (status === 'BLOCKED' || status === 'NEEDS_MAPPING' || status === 'FAILED') return 'attention';
  if (status === 'CANCELLED') return 'muted';
  return 'progress';
}

const TONE_CLASS: Record<StatusTone, string> = {
  progress: 'border-primary/40 bg-primary/10 text-primary',
  done: 'border-green-500/40 bg-green-500/10 text-green-500',
  attention: 'border-destructive/40 bg-destructive/10 text-destructive',
  muted: 'border-border bg-muted text-muted-foreground',
};

export function StatusBadge({ status }: { status: ManualDownloadStatus }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${TONE_CLASS[statusTone(status)]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export const PIPELINE = ['Sent', 'Downloading', 'Importing', 'Imported'] as const;

/** The pipeline step a status has reached (0-based); -1 before Arr grabbed it. */
export function pipelineStep(status: ManualDownloadStatus): number {
  switch (status) {
    case 'QUEUED': return 0;
    // Downloaded and waiting to be imported is as far as Downloading.
    case 'DOWNLOADING':
    case 'IMPORT_PENDING': return 1;
    case 'IMPORTING': return 2;
    case 'IMPORTED': return 3;
    default: return -1;
  }
}

export const appName = (download: Pick<ManualDownloadView, 'service'>) => (download.service === 'RADARR' ? 'Radarr' : 'Sonarr');

export function isOpen(download: Pick<ManualDownloadView, 'status'>): boolean {
  return !['IMPORTED', 'FAILED', 'CANCELLED'].includes(download.status);
}

/** What happens next, or what the user can do about it. */
export function nextStep(download: ManualDownloadView): string {
  const app = appName(download);
  if (download.mode === 'QBIT_REVIEWED') {
    // The advanced fallback: Helprr's own torrent, imported through Arr's manual import.
    switch (download.status) {
      case 'DOWNLOADING': return 'Downloading the chosen files in qBittorrent.';
      case 'IMPORT_PENDING': return `Downloaded. Helprr is asking ${app} what the files are.`;
      case 'IMPORTING': return `${app} is importing the files.`;
      case 'NEEDS_MAPPING': return `${app} is not sure what some files are: map them, or fix it in ${app} and scan again.`;
      case 'BLOCKED': return `Fix what is in the way, then scan again or map the files. Or cancel it here.`;
      default: break;
    }
  }
  switch (download.status) {
    case 'PREFLIGHT':
    case 'CREATING_MEDIA':
    case 'SUBMITTING_RELEASE':
      return `Helprr is sending it to ${download.instanceLabel}.`;
    case 'QUEUED':
      return `${app} grabbed it. Helprr keeps following it in ${app}'s queue.`;
    case 'DOWNLOADING':
      return download.downloadClientName ? `Downloading in ${download.downloadClientName}.` : 'Downloading.';
    case 'IMPORT_PENDING':
      return `Downloaded. ${app} imports it when it next checks its downloads.`;
    case 'IMPORTING':
      return `${app} is importing it.`;
    case 'IMPORTED':
      return `${download.arrItemTitle} has ${download.importedFileCount === 1 ? 'the new file' : download.importedFileCount ? `${download.importedFileCount} new files` : 'the new files'} in ${app}.`;
    case 'BLOCKED':
      return `Fix it in ${app} (Activity → Queue, or its manual import), or cancel it here. Helprr keeps checking.`;
    case 'NEEDS_MAPPING':
      return 'Choose what the files are.';
    case 'FAILED':
      return 'Nothing more will happen. Send the release again once the reason is fixed.';
    case 'CANCELLED':
      return 'Cancelled.';
  }
}

/** Where the title lives in Helprr, on its own instance. */
export function titleHref(download: Pick<ManualDownloadView, 'service' | 'arrItemId' | 'instanceId'>): string | null {
  if (!download.arrItemId) return null;
  const base = download.service === 'RADARR' ? `/movies/${download.arrItemId}` : `/series/${download.arrItemId}`;
  return download.instanceId ? `${base}?instance=${download.instanceId}` : base;
}
