import { format, parse } from 'date-fns';
import type { SonarrSeries } from '@/types';
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
  return format(date, includeTime ? "MMM d, yyyy 'at' h:mm a" : 'MMM d, yyyy');
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

export const MONITOR_OPTIONS = [
  { value: 'all', label: 'All Episodes' },
  { value: 'future', label: 'Future Episodes' },
  { value: 'missing', label: 'Missing Episodes' },
  { value: 'existing', label: 'Existing Episodes' },
  { value: 'recent', label: 'Recent Episodes' },
  { value: 'pilot', label: 'Pilot Episode' },
  { value: 'firstSeason', label: 'First Season' },
  { value: 'lastSeason', label: 'Last Season' },
  { value: 'monitorSpecials', label: 'Monitor Specials' },
  { value: 'unmonitorSpecials', label: 'Unmonitor Specials' },
  { value: 'none', label: 'None' },
];

/** The series as Sonarr should store it for a monitoring option chosen in the Monitor drawer. */
export function buildMonitorUpdate(series: SonarrSeries, monitorOption: string) {
  return {
    ...series,
    monitored: monitorOption !== 'none',
    seasons: series.seasons.map((s) => {
      switch (monitorOption) {
        case 'all':
          return { ...s, monitored: true };
        case 'future':
          return { ...s, monitored: true };
        case 'none':
          return { ...s, monitored: false };
        case 'firstSeason':
          return { ...s, monitored: s.seasonNumber === 1 };
        case 'lastSeason': {
          const maxSeason = Math.max(...series.seasons.filter((ss) => ss.seasonNumber > 0).map((ss) => ss.seasonNumber));
          return { ...s, monitored: s.seasonNumber === maxSeason };
        }
        case 'monitorSpecials':
          return { ...s, monitored: true };
        case 'unmonitorSpecials':
          return { ...s, monitored: s.seasonNumber !== 0 ? s.monitored : false };
        default:
          return { ...s, monitored: true };
      }
    }),
    addOptions: { monitor: monitorOption },
  };
}
