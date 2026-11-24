import {
  getProwlarrIndexerStatusId,
  isProwlarrIndexerBlocked,
  type ProwlarrIndexerStatus,
  type ProwlarrIndexerSummary,
} from '@/lib/prowlarr-client';
import type { ProwlarrIndexerSort, ProwlarrIndexerView } from '@/lib/prowlarr-indexer-view';

export const INDEXER_SORT_OPTIONS: { key: ProwlarrIndexerSort; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'priority', label: 'Priority' },
  { key: 'protocol', label: 'Protocol' },
  { key: 'privacy', label: 'Privacy' },
  { key: 'added', label: 'Added' },
];

const PROTOCOL_LABELS: Record<string, string> = { torrent: 'Torrent', usenet: 'Usenet' };
const PRIVACY_LABELS: Record<string, string> = { public: 'Public', semiPrivate: 'Semi-private', private: 'Private' };
// Prowlarr's own order, most open first.
const PRIVACY_ORDER: Record<string, number> = { public: 0, semiPrivate: 1, private: 2 };

export const protocolLabel = (value: string) => PROTOCOL_LABELS[value] ?? value;
export const privacyLabel = (value: string) => PRIVACY_LABELS[value] ?? value;

/**
 * Failing: Prowlarr has counted failures it has not yet earned back
 * (escalationLevel), or has blocked the indexer for a while.
 */
export function isIndexerFailing(indexerId: number, statuses: ProwlarrIndexerStatus[], now = Date.now()): boolean {
  return statuses.some((status) => (
    getProwlarrIndexerStatusId(status) === indexerId
    && ((status.escalationLevel ?? 0) > 0 || isProwlarrIndexerBlocked(status, now))
  ));
}

/** The values one of the list's properties takes, for a filter's choices; picked ones are kept even when no indexer has them now. */
export function choicesOf(indexers: ProwlarrIndexerSummary[], key: 'protocol' | 'privacy', picked: string[]): string[] {
  const values = new Set(picked);
  for (const indexer of indexers) if (indexer[key]) values.add(indexer[key]);
  const order = key === 'privacy' ? PRIVACY_ORDER : {};
  return [...values].sort((a, b) => (order[a] ?? 9) - (order[b] ?? 9) || a.localeCompare(b));
}

/** Whether any part of the view hides indexers (sort order does not). */
export function hasIndexerFilters(view: ProwlarrIndexerView): boolean {
  return view.search.trim() !== ''
    || view.state !== 'all'
    || view.failing
    || view.protocols.length > 0
    || view.privacy.length > 0
    || view.tags.length > 0
    || view.appProfiles.length > 0;
}

function compare(a: ProwlarrIndexerSummary, b: ProwlarrIndexerSummary, sort: ProwlarrIndexerSort): number {
  switch (sort) {
    case 'priority': return a.priority - b.priority;
    case 'protocol': return a.protocol.localeCompare(b.protocol);
    case 'privacy': return (PRIVACY_ORDER[a.privacy] ?? 9) - (PRIVACY_ORDER[b.privacy] ?? 9);
    // An indexer without a date sorts as the oldest.
    case 'added': return (Date.parse(a.added ?? '') || 0) - (Date.parse(b.added ?? '') || 0);
    default: return 0;
  }
}

/** The loaded list narrowed and ordered as the view says; ties fall back to the name, A–Z. */
export function applyIndexerView(
  indexers: ProwlarrIndexerSummary[],
  statuses: ProwlarrIndexerStatus[],
  view: ProwlarrIndexerView,
  now = Date.now(),
): ProwlarrIndexerSummary[] {
  const query = view.search.trim().toLowerCase();
  const direction = view.sortDirection === 'desc' ? -1 : 1;
  return indexers
    .filter((indexer) => (
      (!query || indexer.name.toLowerCase().includes(query))
      && (view.state === 'all' || indexer.enable === (view.state === 'enabled'))
      && (!view.failing || isIndexerFailing(indexer.id, statuses, now))
      && (view.protocols.length === 0 || view.protocols.includes(indexer.protocol))
      && (view.privacy.length === 0 || view.privacy.includes(indexer.privacy))
      && (view.tags.length === 0 || indexer.tags.some((tag) => view.tags.includes(tag)))
      && (view.appProfiles.length === 0 || (indexer.appProfileId !== undefined && view.appProfiles.includes(indexer.appProfileId)))
    ))
    .sort((a, b) => (
      direction * compare(a, b, view.sort)
      || (view.sort === 'name' ? direction : 1) * a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    ));
}
