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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const USER_ID_RE = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

function toDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function getDefaultEndDate(): string {
  return toDateStr(new Date());
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

/**
 * Escapes single quotes for SQLite string literals by doubling them.
 * Callers must still pre-validate untrusted values (for example via USER_ID_RE/DATE_RE).
 */
export function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

export interface PlaybackQueryEntry {
  label: string;
  count: number;
  time: number;
}

interface CustomQueryClient {
  submitCustomQuery: (sql: string) => Promise<{ columns: string[]; results: string[][] } | null>;
}

interface UserPlaybackQueryOptions {
  defaultDays: number;
  itemType: 'Movie' | 'Episode';
  labelExpr: string;
}

type UserPlaybackQueryResult =
  | { kind: 'badRequest'; error: string }
  | { kind: 'ok'; entries: PlaybackQueryEntry[]; pluginAvailable: boolean };

export async function executeUserPlaybackQuery(
  client: CustomQueryClient,
  userId: string,
  searchParams: URLSearchParams,
  options: UserPlaybackQueryOptions
): Promise<UserPlaybackQueryResult> {
  let range: { days: number; startDate: string; endDate: string };
  try {
    range = parsePlaybackDateRange(searchParams.get('days'), searchParams.get('endDate'), options.defaultDays);
  } catch (error) {
    return {
      kind: 'badRequest',
      error: error instanceof Error ? error.message : 'Invalid date range',
    };
  }

  const query = `
    SELECT
      ${options.labelExpr} as Label,
      COUNT(*) as Plays,
      COALESCE(SUM(PlayDuration), 0) as TotalDuration
    FROM PlaybackActivity
    WHERE ItemType = '${options.itemType}'
      AND date(DateCreated) >= date('${escapeSqlLiteral(range.startDate)}')
      AND date(DateCreated) <= date('${escapeSqlLiteral(range.endDate)}')
      AND UserId = '${escapeSqlLiteral(userId)}'
    GROUP BY Label
    ORDER BY Plays DESC, TotalDuration DESC
  `;

  const result = await client.submitCustomQuery(query).catch(() => null);
  if (!result || !Array.isArray(result.results)) {
    return { kind: 'ok', entries: [], pluginAvailable: false };
  }

  const entries = result.results
    .filter((row): row is string[] => Array.isArray(row))
    .map((row) => ({
      label: String(row[0] ?? 'Unknown'),
      count: Number.parseFloat(String(row[1] ?? '0')) || 0,
      time: Number.parseFloat(String(row[2] ?? '0')) || 0,
    }))
    .filter((row) => row.label && (row.count > 0 || row.time > 0));

  return { kind: 'ok', entries, pluginAvailable: true };
}
