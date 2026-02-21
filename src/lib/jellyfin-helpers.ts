import type { JellyfinItem } from '@/types/jellyfin';

export function ticksToMinutes(ticks: number): string {
  const totalMinutes = Math.floor(ticks / 600000000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function ticksToProgress(position: number, runtime: number): number {
  if (!runtime || runtime === 0) return 0;
  return Math.min(100, (position / runtime) * 100);
}

export function getSessionTitle(item: JellyfinItem): string {
  if (item.Type === 'Episode' && item.SeriesName) {
    const s = item.ParentIndexNumber != null ? `S${item.ParentIndexNumber}` : '';
    const e = item.IndexNumber != null ? `E${item.IndexNumber}` : '';
    return `${item.SeriesName} ${s}${e}`;
  }
  return item.Name;
}

export function formatDurationSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
