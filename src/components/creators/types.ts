import { qualityLabel, qualityOf } from '@/lib/youtube/formats';

export interface CreatorVideoItem {
  id: string;
  externalId: string;
  type: 'ARCHIVE' | 'HIGHLIGHT' | 'UPLOAD' | 'CLIP' | 'SHORT';
  title: string;
  description: string | null;
  sourceCreatedAt: string;
  durationSeconds: number;
  thumbnailUrl: string | null;
  category: string | null;
  viewCount: number;
  mutedSegments: Array<{ duration: number; offset: number }> | null;
  chapters: Array<{ start: number; title: string }> | null;
  availability: 'RECORDING' | 'PUBLISHED' | 'UNAVAILABLE';
  estimatedExpiresAt: string | null;
  creator: { id: string; login: string; displayName: string; profileImageUrl: string | null; isLive: boolean };
  seen: boolean;
  downloaded: boolean;
  fileId: string | null;
  jellyfinItemId: string | null;
  activeJob: {
    id: string;
    state: string;
    source?: string;
    runAfter?: string;
    stage: string | null;
    chosenFormat?: string | null;
    progress: number | null;
  } | null;
}

export interface CreatorVideoPage {
  videos: CreatorVideoItem[];
  categories?: string[];
  total: number;
  page: number;
  pageSize: number;
}

export const VIDEO_TYPE_LABELS: Record<CreatorVideoItem['type'], string> = {
  ARCHIVE: 'Past broadcast',
  HIGHLIGHT: 'Highlight',
  UPLOAD: 'Upload',
  CLIP: 'Clip',
  SHORT: 'Short',
};

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Short clips round to nothing in GB, so anything under 1 GB reads in MB. */
export function formatGb(gb: number): string {
  return gb < 1 ? `${Math.ceil(gb * 1024)} MB` : `${gb.toFixed(1)} GB`;
}

/** The worker reports stages in lower case: "reading metadata". */
export function stageLabel(stage: string): string {
  return stage.charAt(0).toUpperCase() + stage.slice(1);
}

/** When a queued job that is waiting for its time will start, in the viewer's own clock. Null once it may start. */
export function startsLabel(job: { state: string; runAfter?: string | null }, now = new Date()): string | null {
  if (job.state !== 'QUEUED' || !job.runAfter) return null;
  const at = new Date(job.runAfter);
  if (!(at > now)) return null;
  const time: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  return at.toDateString() === now.toDateString()
    ? `Starts ${at.toLocaleTimeString(undefined, time)}`
    : `Starts ${at.toLocaleString(undefined, { month: 'short', day: 'numeric', ...time })}`;
}

/**
 * A rule's download that has not started, which a person may start now. Not tied to its start
 * time: a page left open past it would otherwise go on offering a start the server refuses.
 */
export function isWaitingRuleJob(job: { state: string; source?: string }): boolean {
  return job.source === 'RULE' && job.state === 'QUEUED';
}

/**
 * Whether a person can choose a YouTube download: nothing saved or under way, or a rule's
 * download that has not started, which their choices start now. Twitch's rule jobs never wait.
 */
export function canChooseDownload(video: Pick<CreatorVideoItem, 'downloaded' | 'availability' | 'activeJob'>): boolean {
  return !video.downloaded && video.availability === 'PUBLISHED' && (!video.activeJob || isWaitingRuleJob(video.activeJob));
}

/** A download job's state, in the same words and colours on the Queue and on a video's page. */
export const JOB_STATE_BADGES: Record<string, { label: string; className: string }> = {
  RUNNING: { label: 'Downloading', className: 'bg-primary/15 text-primary' },
  QUEUED: { label: 'Queued', className: '' },
  RETRY_WAIT: { label: 'Retrying soon', className: 'bg-amber-500/15 text-amber-400' },
  BLOCKED: { label: 'Disk full', className: 'bg-amber-500/15 text-amber-400' },
  FAILED: { label: 'Failed', className: 'bg-red-500/15 text-red-400' },
  DONE: { label: 'Done', className: 'bg-green-500/15 text-green-400' },
};

/** A job that has not started says so: a queued one still waiting for its time is Waiting. */
export function jobBadge(job: { state: string; runAfter?: string | null }, now = new Date()): { label: string; className: string } {
  const badge = JOB_STATE_BADGES[job.state] ?? { label: job.state.toLowerCase(), className: '' };
  return startsLabel(job, now) ? { ...badge, label: 'Waiting' } : badge;
}

/** The name of a file's picture: 1280×640 is a 720p video, whatever its height says. */
export function fileQuality({ width, height }: { width: number | null; height: number | null }): string | null {
  if (!height) return null;
  return width ? qualityLabel(qualityOf(width, height)) : `${height}p`;
}

/** Keeps a list's progress bars moving while something downloads, then stops by itself. */
export const whileDownloading = (query: { state: { data?: { pages: CreatorVideoPage[] } } }) => (
  query.state.data?.pages.some((page) => page.videos.some((video) => video.activeJob)) ? 5_000 : false
);

export function daysUntil(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - now) / 86_400_000);
}
