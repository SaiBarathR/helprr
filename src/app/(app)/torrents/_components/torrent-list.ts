import type { QBittorrentTorrent } from '@/types';
import type { TorrentsFilterPreference as FilterType, TorrentsSortKeyPreference as SortKey } from '@/lib/store';

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
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
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

export const filterOptions: { value: FilterType; label: string }[] = [
  { value: 'downloading', label: 'Downloading' },
  { value: 'seeding', label: 'Seeding' },
  { value: 'completed', label: 'Completed' },
  { value: 'paused', label: 'Paused' },
  { value: 'active', label: 'Active' },
];

const DOWNLOADING_STATES = new Set([
  'downloading', 'metaDL', 'allocating', 'stalledDL', 'queuedDL', 'checkingDL', 'forcedDL',
]);
const SEEDING_STATES = new Set([
  'uploading', 'stalledUP', 'queuedUP', 'checkingUP', 'forcedUP', 'pausedUP', 'stoppedUP',
]);
// qBittorrent 5.x renamed pausedDL/pausedUP to stoppedDL/stoppedUP.
export const PAUSED_STATES = new Set(['pausedDL', 'pausedUP', 'stoppedDL', 'stoppedUP']);

export function matchesTorrentFilter(t: QBittorrentTorrent, f: FilterType): boolean {
  switch (f) {
    case 'all': return true;
    case 'downloading': return DOWNLOADING_STATES.has(t.state);
    case 'seeding': return SEEDING_STATES.has(t.state);
    case 'completed': return t.progress >= 1;
    case 'paused': return PAUSED_STATES.has(t.state);
    case 'active': return t.dlspeed > 0 || t.upspeed > 0;
    default: return true;
  }
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
