export interface FileJob {
  id: string;
  kind: 'DOWNLOAD' | 'REENCODE' | 'DELETE_FILES' | 'DELETE_ORIGINAL' | 'RESTORE_ORIGINAL';
  state: string;
  stage: string | null;
  progress: number | null;
  priority: number;
}

export interface TwitchFile {
  id: string;
  videoId: string;
  twitchVideoId: string;
  type: 'ARCHIVE' | 'HIGHLIGHT' | 'UPLOAD' | 'CLIP';
  title: string;
  thumbnailUrl: string | null;
  streamedAt: string;
  streamer: { id: string; displayName: string; profileImageUrl: string | null };
  sizeBytes: number;
  durationSeconds: number;
  videoCodec: string;
  height: number | null;
  downloadedAt: string;
  keepForever: boolean;
  jellyfinItemId: string | null;
  watchedAt: string | null;
  chatArchived: boolean;
  reencodedAt: string | null;
  reencodeQuality: number | null;
  reencodeSkippedAt: string | null;
  reencodeSkippedBytes: number | null;
  originalKept: boolean;
  originalDeleteAfter: string | null;
  originalDeletedAt: string | null;
  originalSizeBytes: number | null;
  originalVideoCodec: string | null;
  activeJob: FileJob | null;
}

export interface TimelineJob {
  id: string;
  kind: FileJob['kind'];
  state: string;
  source: 'MANUAL' | 'RULE' | 'URGENCY' | 'URL';
  requestedByUsername: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface TimelineDeletion {
  id: string;
  cause: DeletionCause;
  freedBytes: number;
  deletedBy: string | null;
  createdAt: string;
}

export interface TwitchFileDetail extends TwitchFile {
  cleanup: {
    keepLatest: number | null;
    deleteAfterDays: number | null;
    deleteAfterWatchedDays: number | null;
    deleteAfter: string | null;
    reason: string | null;
  };
  timeline: { jobs: TimelineJob[]; deletions: TimelineDeletion[] };
}

export interface LibrarySummary {
  count: number;
  totalBytes: number;
  savedBytes: number;
  reencoded: number;
  reencodeWaiting: number;
  originalsKept: number;
  originalsBytes: number;
  freedBytes: number;
  diskFreeBytes: number | null;
  streamers: Array<{ id: string; displayName: string; count: number; bytes: number }>;
}

export type DeletionCause = 'PERSON' | 'RULE' | 'KEEP_PERIOD' | 'OUTSIDE';

export interface DeletedFile {
  id: string;
  videoId: string | null;
  title: string;
  streamer: string;
  kind: 'FILE' | 'ORIGINAL';
  cause: DeletionCause;
  detail: string | null;
  freedBytes: number;
  deletedBy: string | null;
  createdAt: string;
}

export function savedBytes(file: Pick<TwitchFile, 'reencodedAt' | 'sizeBytes' | 'originalSizeBytes'>): number | null {
  return file.reencodedAt && file.originalSizeBytes !== null ? file.originalSizeBytes - file.sizeBytes : null;
}

export function savedPercent(file: Pick<TwitchFile, 'reencodedAt' | 'sizeBytes' | 'originalSizeBytes'>): number | null {
  const saved = savedBytes(file);
  return saved === null || !file.originalSizeBytes ? null : Math.round((saved / file.originalSizeBytes) * 100);
}

const CODECS: Record<string, string> = { h264: 'H.264', hevc: 'HEVC', av1: 'AV1' };

export function codecLabel(codec: string): string {
  return CODECS[codec] ?? codec.toUpperCase();
}

/** Bits per second, from the size: the file carries video and audio together. */
export function bitrateLabel(bytes: number, seconds: number): string | null {
  if (seconds <= 0) return null;
  const megabits = (bytes * 8) / seconds / 1_000_000;
  return `${megabits >= 10 ? Math.round(megabits) : megabits.toFixed(1)} Mbps`;
}

export function jobLabel(job: FileJob): string {
  const percent = job.progress ? ` ${Math.round(job.progress * 100)}%` : '';
  if (job.kind === 'REENCODE') {
    if (job.state === 'RUNNING') return `Re-encoding${percent}`;
    return job.priority > 0 ? 'Re-encoding soon' : 'Waiting for tonight';
  }
  if (job.kind === 'DELETE_ORIGINAL') return 'Deleting original';
  if (job.kind === 'RESTORE_ORIGINAL') return 'Restoring original';
  if (job.kind === 'DELETE_FILES') return 'Deleting';
  return 'Downloading';
}

export const DELETION_CAUSES: Record<DeletionCause, string> = {
  PERSON: 'Deleted by hand',
  RULE: 'Deleted by a cleanup rule',
  KEEP_PERIOD: 'Keep period ended',
  OUTSIDE: 'Removed outside Helprr',
};
