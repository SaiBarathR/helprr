import { MAX_BULK_EDIT_IDS, toPositiveIntArray } from '@/lib/bulk-editor';

// Sonarr's Monitoring choices, as its own Monitoring menu offers them (its
// MonitorTypes less the internal unknown/skip/latestSeason). Sonarr applies one
// to a series' episodes through POST /api/v3/seasonpass, the same rules it uses
// when a series is added.
export const SERIES_MONITOR_OPTIONS = [
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
] as const;

export type SeriesMonitorOption = (typeof SERIES_MONITOR_OPTIONS)[number]['value'];

export function seriesMonitorLabel(value: string): string | undefined {
  return SERIES_MONITOR_OPTIONS.find((o) => o.value === value)?.label;
}

/** The body of POST /api/sonarr/seasonpass: which series, and the choice to apply to them. */
export function parseSeasonPassBody(body: unknown): { ids: number[]; monitor: SeriesMonitorOption } | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Invalid body' };
  const b = body as Record<string, unknown>;
  const ids = toPositiveIntArray(b.ids);
  if (!ids) return { error: 'ids must be a non-empty array of positive integers' };
  if (ids.length > MAX_BULK_EDIT_IDS) return { error: `ids must list at most ${MAX_BULK_EDIT_IDS} items` };
  const monitor = SERIES_MONITOR_OPTIONS.find((o) => o.value === b.monitor)?.value;
  if (!monitor) return { error: 'monitor must be one of Sonarr’s monitoring options' };
  return { ids, monitor };
}
