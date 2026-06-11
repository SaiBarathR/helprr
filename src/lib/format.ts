import { formatDistanceToNow } from 'date-fns';

function parseDateSafe(input: string): Date | null {
  const date = new Date(input);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 0) return `-${formatBytes(Math.abs(bytes))}`;
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const rawIndex = Math.floor(Math.log(bytes) / Math.log(k));
  const i = Number.isFinite(rawIndex) ? Math.max(0, Math.min(rawIndex, sizes.length - 1)) : 0;
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function formatCurrency(value: number | null): string | null {
  if (!value || value <= 0) return null;
  return `$${value.toLocaleString()}`;
}

// 0-23 hour-of-day → 12-hour clock label (e.g. 23 → "11:00 PM").
export function hourLabel(h: number): string {
  if (h === 0) return '12:00 AM';
  if (h < 12) return `${h}:00 AM`;
  if (h === 12) return '12:00 PM';
  return `${h - 12}:00 PM`;
}

export function formatDistanceToNowSafe(input: string, fallback = 'unknown'): string {
  const date = parseDateSafe(input);
  if (!date) return fallback;
  return formatDistanceToNow(date, { addSuffix: true });
}

export function formatDistanceToNowShort(input: string, fallback = 'unknown'): string {
  const date = parseDateSafe(input);
  if (!date) return fallback;
  return formatDistanceToNow(date, { addSuffix: true }).replace(/^about /, '');
}
