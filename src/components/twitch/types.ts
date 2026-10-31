export interface TwitchVideo {
  id: string;
  twitchVideoId: string;
  type: 'ARCHIVE' | 'HIGHLIGHT' | 'UPLOAD' | 'CLIP';
  title: string;
  description: string | null;
  twitchCreatedAt: string;
  durationSeconds: number;
  thumbnailUrl: string | null;
  category: string | null;
  viewCount: number;
  mutedSegments: Array<{ duration: number; offset: number }> | null;
  chapters: Array<{ start: number; title: string }> | null;
  availability: 'RECORDING' | 'PUBLISHED' | 'UNAVAILABLE';
  estimatedExpiresAt: string | null;
  streamer: { id: string; login: string; displayName: string; profileImageUrl: string | null; isLive: boolean };
  seen: boolean;
  downloaded: boolean;
  fileId: string | null;
  jellyfinItemId: string | null;
  activeJob: { id: string; state: string; stage: string | null; progress: number | null } | null;
}

export interface TwitchVideoPage {
  videos: TwitchVideo[];
  categories?: string[];
  total: number;
  page: number;
  pageSize: number;
}

export const VIDEO_TYPE_LABELS: Record<TwitchVideo['type'], string> = {
  ARCHIVE: 'Past broadcast',
  HIGHLIGHT: 'Highlight',
  UPLOAD: 'Upload',
  CLIP: 'Clip',
};

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** The worker reports stages in lower case: "reading metadata". */
export function stageLabel(stage: string): string {
  return stage.charAt(0).toUpperCase() + stage.slice(1);
}

/** Whether text clamped to three lines has anything left to reveal. */
export function overflowsClamp(text: string): boolean {
  return text.length > 140 || text.split('\n').length > 3;
}

export function daysUntil(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - now) / 86_400_000);
}
