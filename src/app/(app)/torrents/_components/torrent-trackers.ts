import type { TorrentTracker } from '@/lib/qbittorrent-client';

/**
 * The torrent's real trackers. qBittorrent's `torrents/trackers` also lists DHT, PeX
 * and LSD as pseudo-entries whose url starts with `** [`; every other url (udp, http,
 * https, wss) is a tracker.
 */
export function realTrackers(trackers: TorrentTracker[]): TorrentTracker[] {
  return trackers.filter((t) => !t.url.startsWith('** ['));
}

/** qBittorrent `torrents/trackers` status codes (the API reports tracker errors as 4). */
const TRACKER_STATUS: Record<number, string> = {
  0: 'Disabled',
  1: 'Not contacted',
  2: 'Working',
  3: 'Updating',
  4: 'Not working',
};

export function trackerStatusLabel(status: number): string {
  return TRACKER_STATUS[status] ?? 'Unknown';
}

/** qBittorrent reports -1 for a count it does not have yet. */
export function trackerCount(value: number): string {
  return value >= 0 ? String(value) : 'N/A';
}
