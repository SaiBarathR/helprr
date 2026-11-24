import type { QBittorrentTorrent } from '@/types';
import {
  CHECKING_STATES,
  DOWNLOADING_STATES,
  ERRORED_STATES,
  MOVING_STATES,
  PAUSED_STATES,
  SEEDING_STATES,
  STALLED_STATES,
  torrentIsActive,
} from '@/lib/qbittorrent-summary';
import type { TorrentsFilterPreference as FilterType, TorrentsSortKeyPreference as SortKey } from '@/lib/store';
import { parseTorrentTags } from './torrent-tags';

export const TORRENT_ROW_HEIGHT = 160;

const TORRENT_ACTION_MESSAGES: Record<string, { single: string; bulk?: string }> = {
  start: { single: 'Started', bulk: 'start' },
  stop: { single: 'Stopped', bulk: 'stop' },
  forceStart: { single: 'Force started', bulk: 'force start' },
  delete: { single: 'Deleted', bulk: 'delete' },
  recheck: { single: 'Rechecking', bulk: 'recheck' },
  reannounce: { single: 'Reannounced', bulk: 'reannounce' },
  setCategory: { single: 'Category set', bulk: 'set category for' },
};

export function torrentActionMessage(action: string, mode: 'single' | 'bulk'): string {
  const message = TORRENT_ACTION_MESSAGES[action];
  if (!message) return mode === 'bulk' ? 'Updated' : 'Action successful';
  return mode === 'bulk' ? message.bulk ?? message.single : message.single;
}

export function formatBytes(bytes: number): string {
  // qBittorrent reports -1 while a torrent is still fetching its metadata.
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(sizes.length - 1, Math.max(0, Math.floor(Math.log(bytes) / Math.log(k))));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/** qBittorrent reports total_size -1 until a torrent has its metadata; its size is unknown, not 0. */
export function torrentSizeUnknown(torrent: Pick<QBittorrentTorrent, 'total_size'>): boolean {
  return (torrent.total_size ?? 0) < 0;
}

export function formatTorrentSize(torrent: Pick<QBittorrentTorrent, 'size' | 'total_size'>): string {
  return torrentSizeUnknown(torrent) ? '—' : formatBytes(torrent.size);
}

export function formatSpeed(bytesPerSec: number): string {
  return formatBytes(bytesPerSec) + '/s';
}

export function formatEta(seconds: number): string {
  if (seconds <= 0 || seconds === 8640000) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatSeedingTime(seconds: number): string {
  if (seconds <= 0) return '-';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || parts.length === 0) parts.push(`${m}m`);
  return parts.join(' ');
}

// In qBittorrent's sidebar order.
export const filterOptions: { value: FilterType; label: string }[] = [
  { value: 'downloading', label: 'Downloading' },
  { value: 'seeding', label: 'Seeding' },
  { value: 'completed', label: 'Completed' },
  { value: 'running', label: 'Running' },
  { value: 'paused', label: 'Paused' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'stalled', label: 'Stalled' },
  { value: 'checking', label: 'Checking' },
  { value: 'moving', label: 'Moving' },
  { value: 'errored', label: 'Errored' },
];

export { PAUSED_STATES };

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

// Every state qBittorrent's API documents (4.x and 5.x). Forced states use the
// solid badge like the running ones; a state added later shows as sent.
const STATE_BADGES: Record<string, { label: string; variant: BadgeVariant }> = {
  downloading: { label: 'Downloading', variant: 'default' },
  metaDL: { label: 'Metadata', variant: 'secondary' },
  forcedMetaDL: { label: 'Forced meta', variant: 'default' },
  allocating: { label: 'Allocating', variant: 'secondary' },
  stalledDL: { label: 'Stalled', variant: 'secondary' },
  uploading: { label: 'Seeding', variant: 'default' },
  stalledUP: { label: 'Seeding', variant: 'secondary' },
  pausedDL: { label: 'Paused', variant: 'outline' },
  pausedUP: { label: 'Paused', variant: 'outline' },
  stoppedDL: { label: 'Stopped', variant: 'outline' },
  stoppedUP: { label: 'Stopped', variant: 'outline' },
  queuedDL: { label: 'Queued', variant: 'secondary' },
  queuedUP: { label: 'Queued', variant: 'secondary' },
  checkingDL: { label: 'Checking', variant: 'secondary' },
  checkingUP: { label: 'Checking', variant: 'secondary' },
  checkingResumeData: { label: 'Checking', variant: 'secondary' },
  forcedDL: { label: 'Forced DL', variant: 'default' },
  forcedUP: { label: 'Forced UL', variant: 'default' },
  moving: { label: 'Moving', variant: 'secondary' },
  missingFiles: { label: 'Missing', variant: 'destructive' },
  error: { label: 'Error', variant: 'destructive' },
  unknown: { label: 'Unknown', variant: 'outline' },
};

export function torrentStateBadge(state: string): { label: string; variant: BadgeVariant } {
  return STATE_BADGES[state] ?? { label: state, variant: 'secondary' };
}

export function matchesTorrentFilter(t: QBittorrentTorrent, f: FilterType): boolean {
  switch (f) {
    case 'all': return true;
    case 'downloading': return DOWNLOADING_STATES.has(t.state);
    case 'seeding': return SEEDING_STATES.has(t.state);
    case 'completed': return t.progress >= 1;
    case 'paused': return PAUSED_STATES.has(t.state);
    // qBittorrent's Running is "not stopped"; a stopped torrent whose files are
    // missing reports missingFiles, which the state alone can't tell apart.
    case 'running': return !PAUSED_STATES.has(t.state);
    case 'active': return torrentIsActive(t);
    case 'inactive': return !torrentIsActive(t);
    case 'stalled': return STALLED_STATES.has(t.state);
    case 'checking': return CHECKING_STATES.has(t.state);
    case 'moving': return MOVING_STATES.has(t.state);
    case 'errored': return ERRORED_STATES.has(t.state);
    default: return true;
  }
}

/**
 * The category, tag and tracker filters. Each list is "any of these" ('' is
 * "none": no category, no tag, no tracker); an empty list doesn't
 * filter, and the lists narrow each other.
 */
export interface TorrentFacetFilters {
  categories: readonly string[];
  tags: readonly string[];
  trackers: readonly string[];
}

export function matchesTorrentFacets(t: QBittorrentTorrent, f: TorrentFacetFilters): boolean {
  if (f.categories.length > 0 && !f.categories.includes(t.category || '')) return false;
  if (f.tags.length > 0) {
    const tags = parseTorrentTags(t.tags);
    if (!f.tags.some((tag) => (tag === '' ? tags.length === 0 : tags.includes(tag)))) return false;
  }
  if (f.trackers.length > 0 && !f.trackers.includes(t.tracker_host ?? '')) return false;
  return true;
}

/** The facet groups of the filter menu, in order, with the name of their '' choice. */
export const TORRENT_FACETS = [
  { key: 'categories', title: 'Category', none: 'No category' },
  { key: 'tags', title: 'Tag', none: 'No tag' },
  // qBittorrent's current tracker; a torrent with none (DHT only, or none answered yet) is ''.
  { key: 'trackers', title: 'Tracker', none: 'No tracker' },
] as const satisfies readonly { key: keyof TorrentFacetFilters; title: string; none: string }[];

/**
 * The choices of each facet menu group: the values the loaded torrents have,
 * sorted, with '' first when some torrent has none, plus any still-picked value
 * no torrent has now, so it can be unpicked. A group where no torrent has a
 * value (no tags anywhere) and nothing is picked has no choice and is empty.
 */
export function torrentFacetOptions(torrents: readonly QBittorrentTorrent[], picked: TorrentFacetFilters) {
  const collect = (valuesOf: (t: QBittorrentTorrent) => string[], chosen: readonly string[]) => {
    const values = new Set<string>(chosen);
    for (const t of torrents) for (const value of valuesOf(t)) values.add(value);
    if (chosen.length === 0 && ![...values].some(Boolean)) return [];
    return [...values].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  };
  return {
    categories: collect((t) => [t.category || ''], picked.categories),
    tags: collect((t) => {
      const tags = parseTorrentTags(t.tags);
      return tags.length > 0 ? tags : [''];
    }, picked.tags),
    trackers: collect((t) => [t.tracker_host ?? ''], picked.trackers),
  };
}

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'size', label: 'Size' },
  { key: 'progress', label: 'Progress' },
  { key: 'dlspeed', label: 'Download Speed' },
  { key: 'upspeed', label: 'Upload Speed' },
  { key: 'eta', label: 'ETA' },
  { key: 'ratio', label: 'Ratio' },
  { key: 'added_on', label: 'Date Added' },
  { key: 'completion_on', label: 'Date Completed' },
  { key: 'num_seeds', label: 'Seeds' },
  { key: 'num_leechs', label: 'Peers' },
  { key: 'priority', label: 'Priority' },
  { key: 'category', label: 'Category' },
  { key: 'state', label: 'Status' },
  { key: 'uploaded', label: 'Uploaded' },
  { key: 'downloaded', label: 'Downloaded' },
  { key: 'amount_left', label: 'Remaining' },
  { key: 'time_active', label: 'Time Active' },
  { key: 'seeding_time', label: 'Seeding Time' },
];

export function compareTorrents(a: QBittorrentTorrent, b: QBittorrentTorrent, key: SortKey): number {
  switch (key) {
    case 'name': return a.name.localeCompare(b.name);
    case 'category': return (a.category || '').localeCompare(b.category || '');
    case 'state': return a.state.localeCompare(b.state);
    case 'size':
    case 'progress':
    case 'dlspeed':
    case 'upspeed':
    case 'eta':
    case 'ratio':
    case 'added_on':
    case 'completion_on':
    case 'num_seeds':
    case 'num_leechs':
    case 'priority':
    case 'uploaded':
    case 'downloaded':
    case 'amount_left':
    case 'time_active':
    case 'seeding_time':
      return a[key] - b[key];
    default: {
      return 0;
    }
  }
}

function sameTorrent(a: QBittorrentTorrent, b: QBittorrentTorrent): boolean {
  return (
    a.hash === b.hash
    && a.name === b.name
    && a.size === b.size
    && a.total_size === b.total_size
    && a.progress === b.progress
    && a.dlspeed === b.dlspeed
    && a.upspeed === b.upspeed
    && a.num_seeds === b.num_seeds
    && a.num_leechs === b.num_leechs
    && a.state === b.state
    && a.eta === b.eta
    && a.category === b.category
    && a.tags === b.tags
    && a.added_on === b.added_on
    && a.completion_on === b.completion_on
    && a.save_path === b.save_path
    && a.ratio === b.ratio
    && a.downloaded === b.downloaded
    && a.uploaded === b.uploaded
    && a.amount_left === b.amount_left
    && a.priority === b.priority
    && a.time_active === b.time_active
    && a.seeding_time === b.seeding_time
    && a.dl_limit === b.dl_limit
    && a.up_limit === b.up_limit
    && a.tracker_host === b.tracker_host
    // The table's optional columns.
    && a.availability === b.availability
    && a.last_activity === b.last_activity
    && a.max_ratio === b.max_ratio
    && a.max_seeding_time === b.max_seeding_time
  );
}

export function mergeTorrents(prev: QBittorrentTorrent[], next: QBittorrentTorrent[]): QBittorrentTorrent[] {
  if (prev.length === 0) return next;

  const prevByHash = new Map(prev.map((torrent) => [torrent.hash, torrent]));
  let changed = prev.length !== next.length;

  const merged = next.map((torrent) => {
    const existing = prevByHash.get(torrent.hash);
    if (existing && sameTorrent(existing, torrent)) {
      return existing;
    }
    changed = true;
    return torrent;
  });

  return changed ? merged : prev;
}

// Optimistic row patches applied to the touched rows before the POST resolves.
// qBittorrent applies actions ASYNCHRONOUSLY: a poll landing right after the
// POST can still report the pre-action data, so each patch's key field is also
// held as a pending override (see the merge effect) until a poll confirms the
// value actually changed — otherwise the reconcile would revert the row.
export const OPTIMISTIC_ROW_PATCHES: Record<
  string,
  (t: QBittorrentTorrent, extra?: Record<string, unknown>) => QBittorrentTorrent
> = {
  start: (t) => ({ ...t, state: t.progress >= 1 ? 'uploading' : 'downloading' }),
  resume: (t) => ({ ...t, state: t.progress >= 1 ? 'uploading' : 'downloading' }),
  forceStart: (t) => ({ ...t, state: t.progress >= 1 ? 'forcedUP' : 'forcedDL' }),
  stop: (t) => ({ ...t, state: t.progress >= 1 ? 'stoppedUP' : 'stoppedDL', dlspeed: 0, upspeed: 0 }),
  pause: (t) => ({ ...t, state: t.progress >= 1 ? 'pausedUP' : 'pausedDL', dlspeed: 0, upspeed: 0 }),
  setCategory: (t, extra) => ({ ...t, category: String(extra?.category ?? '') }),
};

// The field each action's override guards (the one the reconcile must not revert).
export const OPTIMISTIC_OVERRIDE_FIELD: Record<string, 'state' | 'category'> = {
  start: 'state',
  resume: 'state',
  forceStart: 'state',
  stop: 'state',
  pause: 'state',
  setCategory: 'category',
};

// How long an optimistic override (or delete tombstone) may outlive polls that
// still report the pre-action data before we give up and accept the server.
export const OPTIMISTIC_STATE_TTL_MS = 10_000;

export type PendingFieldOverride = {
  field: 'state' | 'category';
  value: string;
  prev: string;
  until: number;
};
