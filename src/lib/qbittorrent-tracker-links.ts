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
 * URL: a tracker edit goes by the tracker's place in the list and the server
 * reads the URL there (`src/lib/qbittorrent-tracker-edits.ts`).
 */

export function seesTrackerUrls(user: Pick<User, 'role'>): boolean {
  return user.role === 'admin';
}

// qBittorrent lists DHT, PeX and LSD as pseudo-trackers named `** [DHT] **`: no URL, nothing to hide.
// Exactly those three; anything else is treated as a URL (and fails closed to its host or `Tracker`).
export const isPseudoTracker = (url: string) => /^\*\* \[(?:DHT|PeX|LSD)\] \*\*$/.test(url);

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

// Every piece of the URL past the host that could be the key: user info, path
// segments, and query names and values (a key can be a bare `?<key>`), each as
// written and decoded, longest first so a part is not left half-replaced.
function urlSecrets(url: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  const pieces = [parsed.username, parsed.password, ...parsed.pathname.split('/'), ...parsed.search.slice(1).split(/[&=;]/)];
  for (const piece of [...pieces]) {
    for (const form of [piece, piece.replace(/\+/g, ' ')]) {
      try {
        pieces.push(decodeURIComponent(form));
      } catch {
        // A malformed escape: the piece as written is already listed.
      }
    }
  }
  // Short pieces (`a`, `1`) and short plain words (`announce`, `tracker`, `scrape.php`) are no key
  // and would blank ordinary words in the message; a random key has digits or is long.
  return [...new Set(pieces.filter((piece) => piece.length >= 6 && !(piece.length < 16 && /^[a-z._-]+$/i.test(piece))))]
    .sort((a, b) => b.length - a.length);
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/*
 * A tracker's message is kept (it says why a tracker fails), but a tracker can
 * echo the announce URL or the passkey in it: URLs are cut to their origin,
 * keys named in a query are removed, and any piece of this torrent's own
 * tracker URLs is replaced wherever it appears.
 */
function messageWithoutSecrets(message: string, secrets: string[]): string {
  let text = redactUpstreamText(urlsToOrigins(message));
  // In any case: a hex key can come back in other capitals.
  for (const secret of secrets) text = text.replace(new RegExp(escapeRegExp(secret), 'gi'), '[REDACTED]');
  return text;
}

// The pieces of every tracker URL of the torrent, longest first.
const trackerSecrets = (trackers: TorrentTracker[]) =>
  [...new Set(trackers.flatMap((tracker) => (isPseudoTracker(tracker.url) ? [] : urlSecrets(tracker.url))))]
    .sort((a, b) => b.length - a.length);

/** The tracker list as this user may see it: full for an admin, hosts and state for anyone else. */
export function trackersForViewer(trackers: TorrentTracker[], fullUrls: boolean): TorrentTracker[] {
  if (fullUrls) return trackers;
  const secrets = trackerSecrets(trackers);
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

/**
 * The torrent's comment (or "created by") as this user may see it. Whoever
 * made the torrent wrote it, and a private tracker can put the torrent's page
 * or a download link with the passkey in it: for an admin as written, for
 * anyone else with the same cleaning as a tracker message (links cut to their
 * host, this torrent's tracker keys removed). Shown as plain text either way.
 */
export function torrentTextForViewer(comment: unknown, trackers: TorrentTracker[], fullUrls: boolean): string {
  if (typeof comment !== 'string') return '';
  return fullUrls ? comment : messageWithoutSecrets(comment, trackerSecrets(trackers));
}
