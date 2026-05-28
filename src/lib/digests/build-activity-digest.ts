import type { NotificationHistory } from '@prisma/client';

export type ActivityDigestPeriod = 'daily' | 'weekly';

export interface ActivityDigestResult {
  title: string;
  body: string;
  /** Number of source events summarized. Zero means there's nothing to send. */
  eventCount: number;
  /** Per-source counts, for diagnostics + tests. */
  sourceCounts: Record<string, number>;
}

interface BuildOptions {
  period: ActivityDigestPeriod;
  /** History rows in the digest window, oldest-to-newest is fine — we re-sort. */
  rows: Pick<NotificationHistory, 'eventType' | 'body' | 'metadata' | 'createdAt'>[];
}

const SOURCE_LABELS: Record<string, string> = {
  sonarr: 'Sonarr',
  radarr: 'Radarr',
  qbittorrent: 'qBittorrent',
  jellyfin: 'Jellyfin',
  seerr: 'Seerr',
  watchlist: 'Watchlist',
  cleanup: 'Cleanup',
};

const HIGHLIGHT_TYPES: ReadonlyArray<string> = [
  // Most user-visible "something good happened" or "something needs attention" rows.
  'imported',
  'requestAvailable',
  'upcomingPremiere',
  'downloadFailed',
  'importFailed',
  'healthWarning',
];

const COUNTED_TYPES_ORDER: ReadonlyArray<{ types: string[]; singular: string; plural: string }> = [
  { types: ['imported'], singular: 'import', plural: 'imports' },
  { types: ['grabbed'], singular: 'download started', plural: 'downloads started' },
  { types: ['downloadFailed'], singular: 'failed download', plural: 'failed downloads' },
  { types: ['importFailed'], singular: 'failed import', plural: 'failed imports' },
  { types: ['torrentCompleted'], singular: 'torrent completed', plural: 'torrents completed' },
  { types: ['requestAvailable'], singular: 'request fulfilled', plural: 'requests fulfilled' },
  { types: ['requestApproved'], singular: 'request approved', plural: 'requests approved' },
  { types: ['healthWarning'], singular: 'health warning', plural: 'health warnings' },
  { types: ['watchlistReminder'], singular: 'watchlist reminder', plural: 'watchlist reminders' },
];

function getSource(row: { metadata: unknown }): string | null {
  if (!row.metadata || typeof row.metadata !== 'object') return null;
  const value = (row.metadata as Record<string, unknown>).source;
  return typeof value === 'string' ? value : null;
}

function pluralize(count: number, { singular, plural }: { singular: string; plural: string }): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Builds the title/body of an activity digest from a window of
 * NotificationHistory rows. Pure — no DB or push side effects.
 *
 * The body has two parts joined by " · ":
 *   1. Counts of common event types (e.g. "5 imports · 2 failed downloads").
 *   2. Up to 3 highlight lines naming specific titles, joined with " · ".
 * If there's nothing to report, returns eventCount=0 and the caller skips.
 */
export function buildActivityDigest(options: BuildOptions): ActivityDigestResult {
  const { period, rows } = options;
  const noun = period === 'weekly' ? 'This week' : 'Today';
  const title = `${noun} on Helprr`;

  const counts: Record<string, number> = {};
  const sourceCounts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.eventType] = (counts[row.eventType] ?? 0) + 1;
    const source = getSource(row);
    if (source) sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;
  }

  const eventCount = rows.length;
  if (eventCount === 0) {
    return {
      title,
      body: '',
      eventCount: 0,
      sourceCounts,
    };
  }

  const summaryParts: string[] = [];
  for (const bucket of COUNTED_TYPES_ORDER) {
    const total = bucket.types.reduce((sum, t) => sum + (counts[t] ?? 0), 0);
    if (total > 0) summaryParts.push(pluralize(total, bucket));
  }

  // Highlights: most recent items in the user-visible types, deduped by title+body.
  const sorted = [...rows].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const seen = new Set<string>();
  const highlights: string[] = [];
  for (const row of sorted) {
    if (!HIGHLIGHT_TYPES.includes(row.eventType)) continue;
    const key = `${row.eventType}:${row.body}`;
    if (seen.has(key)) continue;
    seen.add(key);
    highlights.push(row.body);
    if (highlights.length >= 3) break;
  }

  const sourceSummary = (() => {
    const entries = Object.entries(sourceCounts)
      .map(([source, count]) => `${count} ${SOURCE_LABELS[source] ?? source}`)
      .join(', ');
    return entries ? `via ${entries}` : '';
  })();

  const body = [summaryParts.join(' · '), highlights.join(' · '), sourceSummary]
    .filter(Boolean)
    .join('. ');

  return {
    title,
    body,
    eventCount,
    sourceCounts,
  };
}
