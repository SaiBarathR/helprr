import type { CalendarEvent } from '@/types';

// The Calendar page's filters. Each feed link stores its own (chosen when it is
// made); a link from before named links carries them in its URL instead, and the
// URL's still narrow a link's own. They only narrow what calendar.view shows.

export type FeedEventType = CalendarEvent['type'];

export interface FeedFilters {
  type: FeedEventType | null;
  instanceId: string | null;
  monitoredOnly: boolean;
}

const FEED_TYPES = new Set<string>(['episode', 'movie', 'album']);
const INSTANCE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Parse ?type=&instance=&monitored=; null when one is malformed. */
export function parseFeedFilters(params: URLSearchParams): FeedFilters | null {
  const type = params.get('type');
  const instance = params.get('instance');
  const monitored = params.get('monitored');
  if (type !== null && type !== 'all' && !FEED_TYPES.has(type)) return null;
  if (instance !== null && instance !== 'all' && !INSTANCE_PATTERN.test(instance)) return null;
  if (monitored !== null && monitored !== '0' && monitored !== '1') return null;
  return {
    type: type === null || type === 'all' ? null : (type as FeedEventType),
    instanceId: instance === null || instance === 'all' ? null : instance,
    monitoredOnly: monitored === '1',
  };
}

export const NO_FEED_FILTERS: FeedFilters = { type: null, instanceId: null, monitoredOnly: false };

/**
 * A link's stored filters, as the table holds them. Null when one is not readable,
 * so the link fails closed (it serves nothing) instead of showing everything.
 */
export function storedFeedFilters(row: { type: string | null; instanceId: string | null; monitoredOnly: boolean }): FeedFilters | null {
  if (row.type !== null && !FEED_TYPES.has(row.type)) return null;
  if (row.instanceId !== null && !INSTANCE_PATTERN.test(row.instanceId)) return null;
  return { type: row.type as FeedEventType | null, instanceId: row.instanceId, monitoredOnly: row.monitoredOnly === true };
}

/** Filters sent to make a link ({ type, instanceId, monitoredOnly }, each optional); null when one is malformed. */
export function parseFeedFiltersInput(value: unknown): FeedFilters | null {
  if (value === undefined || value === null) return NO_FEED_FILTERS;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const { type, instanceId, monitoredOnly } = value as Record<string, unknown>;
  if (type !== undefined && type !== null && !(typeof type === 'string' && FEED_TYPES.has(type))) return null;
  if (instanceId !== undefined && instanceId !== null && !(typeof instanceId === 'string' && INSTANCE_PATTERN.test(instanceId))) return null;
  if (monitoredOnly !== undefined && typeof monitoredOnly !== 'boolean') return null;
  return {
    type: typeof type === 'string' ? (type as FeedEventType) : null,
    instanceId: typeof instanceId === 'string' ? instanceId : null,
    monitoredOnly: monitoredOnly === true,
  };
}

export function applyFeedFilters(events: readonly CalendarEvent[], filters: FeedFilters): CalendarEvent[] {
  return events.filter((event) =>
    (!filters.type || event.type === filters.type)
    && (!filters.instanceId || event.instanceId === filters.instanceId)
    && (!filters.monitoredOnly || event.monitored));
}
