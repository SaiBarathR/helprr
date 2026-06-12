// Shared helpers for the Insights & Stats API routes. Date keys are local
// `YYYY-MM-DD` strings (zero-padded, so lexicographic compare == chronological
// compare); they line up with getLocalDateKey() from the timezone module so a
// record's day bucket matches the day labels the page renders.

/** Hard cap on how many day-buckets a single range can produce (payload guard). */
export const INSIGHTS_MAX_DAYS = 366;

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate a `YYYY-MM-DD` query param; returns null for anything malformed or
 * for impossible calendar dates (bad month, or day past the month's length). */
export function normalizeDateKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!DATE_KEY_RE.test(trimmed)) return null;
  const [year, month, day] = trimmed.split('-').map(Number);
  if (month < 1 || month > 12) return null;
  const isLeap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day < 1 || day > daysInMonth) return null;
  return trimmed;
}

/** Shift a `YYYY-MM-DD` key by `delta` days (UTC math, so DST never drifts it). */
export function shiftDayKey(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + delta * 86_400_000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** Inclusive list of day keys from `from` to `to`, capped at INSIGHTS_MAX_DAYS. */
export function eachDayKey(from: string, to: string): string[] {
  const keys: string[] = [];
  let cur = from;
  while (cur <= to && keys.length < INSIGHTS_MAX_DAYS) {
    keys.push(cur);
    cur = shiftDayKey(cur, 1);
  }
  return keys;
}

export type DownloadCategory = 'grabbed' | 'imported' | 'failed';

/**
 * Map an arr history `eventType` string to a download-funnel category, or null
 * for events we don't chart (deleted / renamed / ignored). Works across
 * Sonarr/Radarr/Lidarr — they all carry the eventType as a string in the
 * response. Order matters: "albumImportIncomplete" is a failure even though it
 * contains "import", so the failure test runs first.
 */
export function categorizeHistoryEvent(eventType: string): DownloadCategory | null {
  const e = eventType.toLowerCase();
  if (e.includes('fail') || e.includes('incomplete')) return 'failed';
  if (e.includes('import')) return 'imported';
  if (e.includes('grab')) return 'grabbed';
  return null;
}
