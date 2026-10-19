import { NAVIGATION_START_EVENT, type NavigationStartDetail } from '@/lib/route-scroll-state';

// --- Tabs definition ---

export type TabKey = 'queue' | 'failed' | 'missing' | 'cutoff';

export const TABS: { key: TabKey; label: string }[] = [
  { key: 'queue', label: 'Queue' },
  { key: 'failed', label: 'Failed' },
  { key: 'missing', label: 'Missing' },
  { key: 'cutoff', label: 'Cutoff' },
];

export function isTabKey(value: string): value is TabKey {
  return TABS.some((t) => t.key === value);
}

// --- Sort options ---

export type SortKey = 'title' | 'progress' | 'timeleft' | 'size';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'progress', label: 'Progress' },
  { key: 'timeleft', label: 'Time Left' },
  { key: 'size', label: 'Size' },
];

export const SORT_OPTIONS_BY_TAB: Record<TabKey, { key: SortKey; label: string }[]> = {
  queue: SORT_OPTIONS,
  failed: [],
  missing: [],
  cutoff: [],
};

export function isSortKey(value: string): value is SortKey {
  return SORT_OPTIONS.some((option) => option.key === value);
}

// --- Filter options ---

type FilterKey = 'all' | 'sonarr' | 'radarr' | 'lidarr';

export const FILTER_OPTIONS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'sonarr', label: 'Sonarr' },
  { key: 'radarr', label: 'Radarr' },
  { key: 'lidarr', label: 'Lidarr' },
];

function isFilterKey(value: string): value is FilterKey {
  return FILTER_OPTIONS.some((option) => option.key === value);
}

/** The filters a deep link (?source=) opens, kept for that visit only. */

export interface ActivityLinkView {
  sources: string[];
  instance: string;
}

/**
 * The view an Activity link asks for, or null for a plain visit. Push
 * notifications link `?source=sonarr`; changes made on that view are written
 * back as `?source=sonarr,radarr`, `?source=all` (every source) and
 * `&instance=<id>`. A link starts from every instance rather than the saved one.
 */

export function activityLinkView(params: URLSearchParams): ActivityLinkView | null {
  const raw = params.get('source');
  if (!raw) return null;
  const sources = raw === 'all'
    ? []
    : raw.split(',').filter((key) => isFilterKey(key) && key !== 'all');
  if (raw !== 'all' && sources.length === 0) return null;
  return { sources, instance: params.get('instance') || 'all' };
}

/** Write a link view into the current history entry, or drop it (null). */

export function writeActivityLinkView(view: ActivityLinkView | null) {
  const params = new URLSearchParams(window.location.search);
  params.delete('source');
  params.delete('instance');
  if (view) {
    params.set('source', view.sources.length > 0 ? view.sources.join(',') : 'all');
    if (view.instance !== 'all') params.set('instance', view.instance);
  }
  const query = params.toString();
  const href = query ? `/activity?${query}` : '/activity';
  // A filter change keeps the list where it is: tell the scroll restorer this
  // URL write is the same view, as a router replace with scroll:false would.
  const detail: NavigationStartDetail = { kind: 'replace', href, preserveScroll: true };
  window.dispatchEvent(new CustomEvent(NAVIGATION_START_EVENT, { detail }));
  window.history.replaceState(null, '', href);
}

/**
 * Renders the Activity page with header controls (filter, sort, history, refresh) and tabbed views for Queue, Failed imports, Missing, and Cutoff items.
 *
 * The component manages local UI state for the active tab, refresh state, sort and filter selection, and queue count. It triggers background refresh commands for Sonarr and Radarr, navigates to history and import routes, and passes sorting/filtering props to the tab panels.
 *
 * @returns The Activity page React element
 */
