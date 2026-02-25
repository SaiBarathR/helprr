export function sanitizeDays(
  input: string | null,
  defaultDays: number,
  maxDays = 3650
): number {
  const parsed = input ? Number(input) : Number.NaN;
  if (!Number.isFinite(parsed)) return defaultDays;
  const normalized = Math.floor(parsed);
  if (normalized < 1) return defaultDays;
  return Math.min(normalized, maxDays);
}

export function getDefaultEndDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const USER_ID_RE = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

function toDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function parsePlaybackUserId(input: string | null): string | null {
  if (!input) return null;
  if (!USER_ID_RE.test(input)) {
    throw new Error('userId must be a valid Jellyfin user ID');
  }
  return input;
}

export function parsePlaybackDateRange(
  daysInput: string | null,
  endDateInput: string | null,
  defaultDays: number
): { days: number; startDate: string; endDate: string } {
  const days = sanitizeDays(daysInput, defaultDays);
  const endDate = endDateInput || getDefaultEndDate();
  if (!DATE_RE.test(endDate)) {
    throw new Error('endDate must be YYYY-MM-DD');
  }

  const end = new Date(`${endDate}T12:00:00`);
  if (Number.isNaN(end.getTime())) {
    throw new Error('endDate must be YYYY-MM-DD');
  }

  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));

  return {
    days,
    startDate: toDateStr(start),
    endDate,
  };
}

export function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}
