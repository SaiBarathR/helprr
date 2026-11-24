import { createHmac } from 'crypto';
import { isIP } from 'net';
import type { User } from '@prisma/client';
import type { TorrentPeer, TorrentPeersSync } from '@/lib/qbittorrent-client';
import type { PeerView } from '@/lib/qbittorrent-peer-view';
import type { PeerList } from '@/lib/cache/qbittorrent-peer-delta';

/*
 * A peer's IP address is personal data, and qBittorrent keys every peer by it
 * (`ip:port`). Only an admin, who can read qBittorrent itself, is sent the
 * address. Anyone else with torrents.view gets the rest of the row (client,
 * country, connection, flags, progress, speeds and totals), which is what
 * tells "no peers" from "peers but slow", under a key the server derives from
 * the address: an HMAC, so the browser can follow a peer from one poll to the
 * next without learning, or guessing back, who it is. A ban names the peer by
 * that key and the server finds its address in qBittorrent's current list.
 */

export function seesPeerAddresses(user: Pick<User, 'role'>): boolean {
  return user.role === 'admin';
}

/** The browser's name for one peer of one torrent: stable while it stays connected, not the address. */
export function peerKey(hash: string, address: string): string {
  const secret = process.env.JWT_SECRET || process.env.APP_PASSWORD;
  if (!secret) throw new Error('JWT_SECRET or APP_PASSWORD is required');
  return createHmac('sha256', secret).update(`qbittorrent-peer:${hash.toLowerCase()}:${address}`).digest('base64url').slice(0, 22);
}

const TEXT_FIELDS = ['client', 'peer_id_client', 'connection', 'country', 'country_code', 'flags', 'flags_desc'] as const;
const NUMBER_FIELDS = ['progress', 'relevance', 'dl_speed', 'up_speed', 'downloaded', 'uploaded'] as const;

// Field by field: `ip` and `port` are the address, and `files` (the torrent's own file names) is not shown.
function peerForViewer(peer: Partial<TorrentPeer>, address: string, seesAddress: boolean): PeerView {
  const shown = {} as PeerView;
  for (const field of TEXT_FIELDS) {
    if (typeof peer[field] === 'string') shown[field] = peer[field];
  }
  for (const field of NUMBER_FIELDS) {
    if (typeof peer[field] === 'number' && Number.isFinite(peer[field])) shown[field] = peer[field];
  }
  if (seesAddress) shown.address = address;
  return shown;
}

/** qBittorrent's full list as this user may see it: keyed by peerKey, the address only for an admin. */
export function peersForViewer(hash: string, sync: TorrentPeersSync, seesAddress: boolean): PeerList {
  const peers: Record<string, PeerView> = {};
  for (const [address, peer] of Object.entries(sync.peers ?? {})) {
    if (peer && typeof peer === 'object') peers[peerKey(hash, address)] = peerForViewer(peer, address, seesAddress);
  }
  return { showFlags: typeof sync.show_flags === 'boolean' ? sync.show_flags : null, peers };
}

/** The address qBittorrent lists under this key now; null when that peer is gone. */
export function findPeerAddress(hash: string, sync: TorrentPeersSync, key: string): string | null {
  return Object.keys(sync.peers ?? {}).find((address) => peerKey(hash, address) === key) ?? null;
}

export const MAX_ADDED_PEERS = 50;
const MAX_PEER_LENGTH = 64;
const PORT = /^[1-9]\d{0,4}$/;

// No peer can be at these: unspecified, loopback (qBittorrent's own host), multicast and broadcast.
function notAPeer(ip: string, family: number): boolean {
  if (family === 4) {
    const first = Number(ip.split('.')[0]);
    return first === 0 || first === 127 || first >= 224;
  }
  const lower = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return notAPeer(mapped[1], 4);
  return lower === '::' || lower === '::1' || lower.startsWith('ff');
}

/** One `ip:port` or `[ipv6]:port` in the form qBittorrent parses; null when it is not one. */
export function parsePeerAddress(text: string): string | null {
  const match = /^\[([^\]]+)\]:(\d+)$/.exec(text) ?? /^([^:[\]]+):(\d+)$/.exec(text);
  if (!match) return null;
  const [, ip, port] = match;
  if (!PORT.test(port) || Number(port) > 65535) return null;
  const family = isIP(ip);
  // An IPv6 address only in brackets, as qBittorrent splits on the last `]:`; no zone (`%eth0`).
  if (text.startsWith('[') ? family !== 6 || ip.includes('%') : family !== 4) return null;
  if (notAPeer(ip, family)) return null;
  return family === 6 ? `[${ip.toLowerCase()}]:${port}` : `${ip}:${port}`;
}

export type ParsedPeers = { ok: true; peers: string[] } | { ok: false; error: string };

/** The peers to add, one per entry, at most MAX_ADDED_PEERS. */
export function parsePeerAddresses(input: unknown): ParsedPeers {
  if (!Array.isArray(input)) return { ok: false, error: 'List the peers to add' };
  // Before looking at each entry: the body has no size limit of its own.
  if (input.length > MAX_ADDED_PEERS * 4) return { ok: false, error: `Add at most ${MAX_ADDED_PEERS} peers at a time` };
  const lines = input.map((entry) => (typeof entry === 'string' ? entry.trim() : entry)).filter((entry) => entry !== '');
  if (lines.length === 0) return { ok: false, error: 'List the peers to add' };
  if (lines.length > MAX_ADDED_PEERS) return { ok: false, error: `Add at most ${MAX_ADDED_PEERS} peers at a time` };
  const peers: string[] = [];
  for (const line of lines) {
    const peer = typeof line === 'string' && line.length <= MAX_PEER_LENGTH ? parsePeerAddress(line) : null;
    if (!peer) {
      const shown = typeof line === 'string' ? line.slice(0, MAX_PEER_LENGTH) : 'an entry';
      return { ok: false, error: `Not an IP:port: ${shown}. Write IPv6 as [address]:port.` };
    }
    if (!peers.includes(peer)) peers.push(peer);
  }
  return { ok: true, peers };
}
