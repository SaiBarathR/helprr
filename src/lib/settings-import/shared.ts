// Shared parsing helpers and the request shape for the settings import sections.

import type {
  ExportedAppSettings,
  ExportedAnimeMappings,
  ExportedCleanup,
  ExportedDashboardLayouts,
  ExportedScheduledAlerts,
  ExportedServiceConnection,
  ExportedNotificationDevice,
  ExportedUsers,
  ExportedWatchlist,
} from '@/lib/settings-export';

export const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);

export const UPCOMING_NOTIFY_MODES = new Set(['before_air', 'daily_digest']);

export const ACTIVITY_DIGEST_MODES = new Set(['off', 'daily', 'weekly']);

// Watchlist field caps — match the regular POST /api/watchlist handler so an
// imported backup can't smuggle past validations the live UI enforces.
export const WATCHLIST_MAX_TITLE_LEN = 200;

export const WATCHLIST_MAX_POSTER_URL_LEN = 500;

export const WATCHLIST_MAX_OVERVIEW_LEN = 2000;

export function validateImportedPosterUrl(raw: string): string | null {
  if (raw.length > WATCHLIST_MAX_POSTER_URL_LEN) return null;
  if (!/^https?:\/\//i.test(raw)) return null;
  return raw;
}

export interface ImportRequestBody {
  appSettings?: Partial<ExportedAppSettings>;
  serviceConnections?: ExportedServiceConnection[];
  notificationDevice?: ExportedNotificationDevice;
  cleanup?: ExportedCleanup;
  currentDeviceEndpoint?: string;
  discoverLayout?: Record<string, unknown>;
  dashboardLayouts?: ExportedDashboardLayouts;
  watchlist?: ExportedWatchlist;
  scheduledAlerts?: ExportedScheduledAlerts;
  animeMappings?: ExportedAnimeMappings;
  users?: ExportedUsers;
}

/** Coerce to an integer, or null for null/undefined/non-integer values. */
export function coerceIntOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

/** A nullable hour-of-day (0–23), or null when absent/out of range. */
export function clampHourOrNull(value: unknown): number | null {
  const n = coerceIntOrNull(value);
  if (n === null || n < 0 || n > 23) return null;
  return n;
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isInteger(value)
    ? value
    : typeof value === 'string' && /^\s*-?\d+\s*$/.test(value)
      ? parseInt(value, 10)
      : NaN;
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function pickEnum(value: unknown, allowed: Set<string>, fallback: string): string {
  return typeof value === 'string' && allowed.has(value) ? value : fallback;
}
