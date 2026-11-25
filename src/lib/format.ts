import { formatDistanceToNow } from 'date-fns';
import { formatTime } from '@/lib/date-format';

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

// Sonarr/Radarr history keep the download protocol as its enum number ("1", "2"); other
// records already carry the name ("torrent"). 0 is "unknown".
const DOWNLOAD_PROTOCOLS: Record<string, string> = { '0': 'Unknown', '1': 'Usenet', '2': 'Torrent' };

export function formatDownloadProtocol(protocol: string | number): string {
  const value = String(protocol).trim();
  return DOWNLOAD_PROTOCOLS[value] ?? value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatCurrency(value: number | null): string | null {
  if (!value || value <= 0) return null;
  return `$${value.toLocaleString()}`;
}

// 0-23 hour-of-day → clock label in the user's time format (e.g. 23 → "11:00 PM" / "23:00").
export function hourLabel(h: number): string {
  return formatTime(new Date(2000, 0, 1, h));
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
