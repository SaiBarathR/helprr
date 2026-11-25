import type { QBittorrentTorrent, QBittorrentTorrentInfo, QBittorrentTransferInfo } from '@/types';
import type { TorrentsFilterPreference } from '@/lib/store';

export type ProjectedTorrentSummary = QBittorrentTorrent;

/**
 * A tracker URL's host name alone, without scheme, port, user info, path or
 * query, where a passkey can sit (src/lib/qbittorrent-tracker-links.ts); ''
 * when there is no tracker or it is not a URL. Kept here, not with
 * trackerOrigin, because the torrents page bundles this file.
 */
export function trackerHost(url: string | undefined): string {
  if (!url) return '';
  try {
    // Lower case: URL leaves a udp:// host as written, and one tracker is one host.
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * What a browser gets of a torrent, built field by field. The magnet and the
 * tracker URL are left out: their announce URLs can carry a private tracker's
 * passkey (src/lib/qbittorrent-tracker-links.ts), and the list never shows them.
 * The tracker's host name alone goes, for the Tracker filter.
 */
export function projectTorrentForSummary(torrent: QBittorrentTorrentInfo | QBittorrentTorrent): ProjectedTorrentSummary {
  return {
    hash: torrent.hash,
    name: torrent.name,
    size: torrent.size,
    total_size: torrent.total_size,
    progress: torrent.progress,
    dlspeed: torrent.dlspeed,
    upspeed: torrent.upspeed,
    num_seeds: torrent.num_seeds,
    num_leechs: torrent.num_leechs,
    state: torrent.state,
    eta: torrent.eta,
    category: torrent.category,
    tags: torrent.tags,
    priority: torrent.priority,
    added_on: torrent.added_on,
    completion_on: torrent.completion_on,
    save_path: torrent.save_path,
    amount_left: torrent.amount_left,
    completed: torrent.completed,
    downloaded: torrent.downloaded,
    uploaded: torrent.uploaded,
    downloaded_session: torrent.downloaded_session,
    uploaded_session: torrent.uploaded_session,
    dl_limit: torrent.dl_limit,
    up_limit: torrent.up_limit,
    time_active: torrent.time_active,
    seeding_time: torrent.seeding_time,
    last_activity: torrent.last_activity,
    availability: torrent.availability,
    ratio: torrent.ratio,
    seq_dl: torrent.seq_dl,
    f_l_piece_prio: torrent.f_l_piece_prio,
    force_start: torrent.force_start,
    auto_tmm: torrent.auto_tmm,
    max_ratio: torrent.max_ratio,
    max_seeding_time: torrent.max_seeding_time,
    max_inactive_seeding_time: torrent.max_inactive_seeding_time,
    ratio_limit: torrent.ratio_limit,
    seeding_time_limit: torrent.seeding_time_limit,
    inactive_seeding_time_limit: torrent.inactive_seeding_time_limit,
    private: torrent.private,
    tracker_host: 'tracker' in torrent ? trackerHost(torrent.tracker) : torrent.tracker_host ?? '',
  };
}

export function projectTorrentsForSummary(torrents: Array<QBittorrentTorrentInfo | QBittorrentTorrent>): ProjectedTorrentSummary[] {
  return torrents.map(projectTorrentForSummary);
}

/**
 * The transfer figures the toolbar, widget and Settings show, copied out one by
 * one. qBittorrent's transfer/info also sends last_external_address_v4/_v6,
 * its public IP addresses, which must not reach a browser (any user's).
 */
export function normalizeTransferInfo(info: QBittorrentTransferInfo): QBittorrentTransferInfo {
  return {
    dl_info_speed: info.dl_info_speed,
    dl_info_data: info.dl_info_data,
    up_info_speed: info.up_info_speed,
    up_info_data: info.up_info_data,
    dl_rate_limit: info.dl_rate_limit,
    up_rate_limit: info.up_rate_limit,
    dht_nodes: info.dht_nodes,
    connection_status: info.connection_status,
  };
}

/**
 * Several qBittorrents' transfer figures as one (the dashboard's totals):
 * speeds and amounts add up; a limit is unlimited (0) when any of them is,
 * else the limits add up; the status is "connected" only when all are.
 */
export function sumTransferInfo(infos: QBittorrentTransferInfo[]): QBittorrentTransferInfo | null {
  if (infos.length === 0) return null;
  const sum = (pick: (info: QBittorrentTransferInfo) => number) => infos.reduce((total, info) => total + (pick(info) || 0), 0);
  const limit = (pick: (info: QBittorrentTransferInfo) => number) => (infos.some((info) => !(pick(info) > 0)) ? 0 : sum(pick));
  return {
    dl_info_speed: sum((info) => info.dl_info_speed),
    dl_info_data: sum((info) => info.dl_info_data),
    up_info_speed: sum((info) => info.up_info_speed),
    up_info_data: sum((info) => info.up_info_data),
    dl_rate_limit: limit((info) => info.dl_rate_limit),
    up_rate_limit: limit((info) => info.up_rate_limit),
    dht_nodes: sum((info) => info.dht_nodes),
    connection_status: infos.find((info) => info.connection_status !== 'connected')?.connection_status ?? 'connected',
  };
}

export function passiveTorrentRefreshIntervalMs(baseMs: number, connection?: { saveData?: boolean; effectiveType?: string } | null): number {
  if (!connection?.saveData && connection?.effectiveType !== 'slow-2g' && connection?.effectiveType !== '2g') {
    return baseMs;
  }
  return Math.max(baseMs * 3, 15_000);
}

// One definition for the Torrents filters and the widget counters, so a torrent
// is counted under the filter that shows it. Like qBittorrent's own filters,
// Seeding means seeding now: a stopped finished torrent is Paused only.
export const DOWNLOADING_STATES = new Set([
  'downloading', 'metaDL', 'forcedMetaDL', 'allocating', 'stalledDL', 'queuedDL', 'checkingDL', 'forcedDL',
]);
export const SEEDING_STATES = new Set(['uploading', 'stalledUP', 'queuedUP', 'checkingUP', 'forcedUP']);
// qBittorrent 5.x renamed pausedDL/pausedUP to stoppedDL/stoppedUP.
export const PAUSED_STATES = new Set(['pausedDL', 'pausedUP', 'stoppedDL', 'stoppedUP']);
// The rest follow qBittorrent's own filters (TorrentFilter::matchState and the
// TorrentImpl is* checks it calls), so a filter here lists what the same filter
// lists in qBittorrent.
export const STALLED_STATES = new Set(['stalledDL', 'stalledUP']);
export const CHECKING_STATES = new Set(['checkingDL', 'checkingUP', 'checkingResumeData']);
export const MOVING_STATES = new Set(['moving']);
export const ERRORED_STATES = new Set(['error', 'missingFiles']);
// Always active; stalledDL only while it uploads (TorrentImpl::isActive).
export const ACTIVE_STATES = new Set(['downloading', 'metaDL', 'forcedMetaDL', 'forcedDL', 'uploading', 'forcedUP', 'moving']);

/** qBittorrent's Active: transferring, fetching metadata, forced or moving. Inactive is everything else. */
export function torrentIsActive(torrent: Pick<QBittorrentTorrent, 'state' | 'upspeed'>): boolean {
  return ACTIVE_STATES.has(torrent.state) || (torrent.state === 'stalledDL' && torrent.upspeed > 0);
}

/** One status filter of the Torrents page; the summary route slims its list with it too. */
export function matchesTorrentFilter(t: QBittorrentTorrent, f: TorrentsFilterPreference): boolean {
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

export function torrentCounters(torrents: QBittorrentTorrent[]) {
  let downloading = 0, seeding = 0, paused = 0;
  for (const torrent of torrents) {
    if (DOWNLOADING_STATES.has(torrent.state)) downloading++;
    else if (SEEDING_STATES.has(torrent.state)) seeding++;
    else if (PAUSED_STATES.has(torrent.state)) paused++;
  }
  return { total: torrents.length, downloading, seeding, paused };
}

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
