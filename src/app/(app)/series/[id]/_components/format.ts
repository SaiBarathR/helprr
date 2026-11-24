import { parse } from 'date-fns';
import { formatDate, formatTime } from '@/lib/date-format';
import type { SeriesAniListResponse } from '@/types/anilist';

export function formatCountdown(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return parts.join(' ');
}

export function formatDateValue(value: string | null | undefined, includeTime = false): string | null {
  if (!value) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? parse(value, 'yyyy-MM-dd', new Date())
    : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return includeTime ? `${formatDate(date)} at ${formatTime(date)}` : formatDate(date);
}

export const STATUS_COLORS: Record<string, string> = {
  CURRENT: 'bg-blue-500',
  PLANNING: 'bg-green-500',
  COMPLETED: 'bg-violet-500',
  PAUSED: 'bg-yellow-500',
  DROPPED: 'bg-red-500',
};

export const STATUS_LABELS: Record<string, string> = {
  CURRENT: 'Current',
  PLANNING: 'Planning',
  COMPLETED: 'Completed',
  PAUSED: 'Paused',
  DROPPED: 'Dropped',
};

export function formatAniListMappingState(state: SeriesAniListResponse['mapping']['state'] | null | undefined): string {
  if (state === 'MANUAL_MATCH') return 'Manual match';
  if (state === 'MANUAL_NONE') return 'Manually unmapped';
  if (state === 'AUTO_MATCH') return 'Auto matched';
  if (state === 'AUTO_UNMATCHED') return 'No confident match';
  return 'Not mapped';
}
