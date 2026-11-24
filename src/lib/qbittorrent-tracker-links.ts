import type { User } from '@prisma/client';
import type { TorrentTracker } from '@/lib/qbittorrent-client';
import { redactUpstreamText } from '@/lib/manual-downloads/redact';
import { urlsToOrigins } from '@/lib/url-origins';

/*
 * A private tracker's announce URL carries the user's passkey, in the path
 * (`/announce/<key>`, `/<key>/announce`) or the query (`?passkey=`, `?pk=`,
 * under any name), so it is a credential for the owner's tracker account. It
 * reaches qBittorrent's tracker list and every `tr=` of the torrent's magnet.
 * Only an admin, who can read qBittorrent's own settings anyway, sees them in
 * full; anyone else with torrents.view sees each tracker's host and its state,
 * and a magnet without trackers. Nothing here needs the browser to hold a full
 * URL, so a later tracker edit can go by the tracker's place in the list.
 */

export function seesTrackerUrls(user: Pick<User, 'role'>): boolean {
  return user.role === 'admin';
}

// qBittorrent lists DHT, PeX and LSD as pseudo-trackers named `** [DHT] **`: no URL, nothing to hide.
const isPseudoTracker = (url: string) => url.startsWith('** [');

/** scheme://host[:port] of a tracker URL, without user info, path or query; null when it is not one. */
export function trackerOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.host) return null;
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

// Every piece of the URL past the host that could be the key, longest first so a part is not left half-replaced.
function urlSecrets(url: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  const pieces = [parsed.username, parsed.password, ...parsed.pathname.split('/'), ...[...parsed.searchParams.values()]];
  for (const piece of [...pieces]) {
    try {
      pieces.push(decodeURIComponent(piece));
    } catch {
      // A malformed escape: the piece as written is already listed.
    }
  }
  // Short pieces (`announce`, `a`, `1`) are no key and would blank ordinary words.
  return [...new Set(pieces.filter((piece) => piece.length >= 6 && piece !== 'announce'))].sort((a, b) => b.length - a.length);
}

/*
 * A tracker's message is kept (it says why a tracker fails), but a tracker can
 * echo the announce URL or the passkey in it: URLs are cut to their origin,
 * keys named in a query are removed, and any piece of this torrent's own
 * tracker URLs is replaced wherever it appears.
 */
function messageWithoutSecrets(message: string, secrets: string[]): string {
  let text = redactUpstreamText(urlsToOrigins(message));
  for (const secret of secrets) text = text.split(secret).join('[REDACTED]');
  return text;
}

/** The tracker list as this user may see it: full for an admin, hosts and state for anyone else. */
export function trackersForViewer(trackers: TorrentTracker[], fullUrls: boolean): TorrentTracker[] {
  if (fullUrls) return trackers;
  const secrets = [...new Set(trackers.flatMap((tracker) => (isPseudoTracker(tracker.url) ? [] : urlSecrets(tracker.url))))]
    .sort((a, b) => b.length - a.length);
  return trackers.map((tracker) => ({
    url: isPseudoTracker(tracker.url) ? tracker.url : trackerOrigin(tracker.url) ?? 'Tracker',
    status: tracker.status,
    tier: tracker.tier,
    num_peers: tracker.num_peers,
    num_seeds: tracker.num_seeds,
    num_leeches: tracker.num_leeches,
    num_downloaded: tracker.num_downloaded,
    msg: typeof tracker.msg === 'string' ? messageWithoutSecrets(tracker.msg, secrets) : '',
  }));
}

/**
 * The magnet this user may copy: qBittorrent's own for an admin; for anyone
 * else only its info hashes (`xt`) and name (`dn`), so no `tr=` announce URL
 * (nor a web seed or other link) goes with it. Null when qBittorrent gave none.
 */
export function magnetForViewer(magnetUri: unknown, fullUrls: boolean): string | null {
  if (typeof magnetUri !== 'string' || !magnetUri.startsWith('magnet:?')) return null;
  if (fullUrls) return magnetUri;
  const kept = magnetUri
    .slice('magnet:?'.length)
    .split('&')
    .filter((part) => /^(?:xt|dn)=/i.test(part));
  return kept.some((part) => /^xt=/i.test(part)) ? `magnet:?${kept.join('&')}` : null;
}
