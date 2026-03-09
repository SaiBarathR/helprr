import { formatDistanceToNow } from 'date-fns';

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 0) return `-${formatBytes(Math.abs(bytes))}`;
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const rawIndex = Math.floor(Math.log(bytes) / Math.log(k));
  const i = Number.isFinite(rawIndex) ? Math.max(0, Math.min(rawIndex, sizes.length - 1)) : 0;
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function formatDistanceToNowSafe(input: string, fallback = 'unknown'): string {
  const date = new Date(input);
  if (!Number.isFinite(date.getTime())) return fallback;
  return formatDistanceToNow(date, { addSuffix: true });
}
