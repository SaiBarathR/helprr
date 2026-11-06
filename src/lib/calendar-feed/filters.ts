import type { CalendarEvent } from '@/types';

// The Calendar page's filters, carried in the feed URL so one link can follow
// what the person picked. They only narrow what calendar.view already shows.

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

/** The query string for a token and filters, in the shape parseFeedFilters reads. */
export function feedQuery(token: string, filters: FeedFilters): string {
  const params = new URLSearchParams({ token });
  if (filters.type) params.set('type', filters.type);
  if (filters.instanceId) params.set('instance', filters.instanceId);
  if (filters.monitoredOnly) params.set('monitored', '1');
  return params.toString();
}

export function applyFeedFilters(events: readonly CalendarEvent[], filters: FeedFilters): CalendarEvent[] {
  return events.filter((event) =>
    (!filters.type || event.type === filters.type)
    && (!filters.instanceId || event.instanceId === filters.instanceId)
    && (!filters.monitoredOnly || event.monitored));
}
