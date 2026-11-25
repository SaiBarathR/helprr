/*
 * The peers list as the browser holds it (no imports, so the page can use it).
 * The server sends the list keyed by an opaque key per peer
 * (src/lib/qbittorrent-peers.ts): in full, or since the list the page's
 * `cursor` names only the fields that changed and the keys of peers that left
 * (src/lib/cache/qbittorrent-peer-delta.ts).
 */

export interface PeerView {
  /** `ip:port` (`[ipv6]:port`): sent to an admin only. */
  address?: string;
  client: string;
  peer_id_client: string;
  /** BT, μTP or Web. */
  connection: string;
  /** Only while qBittorrent resolves peer countries. */
  country?: string;
  country_code?: string;
  flags: string;
  flags_desc: string;
  /** 0–1. */
  progress: number;
  relevance: number;
  dl_speed: number;
  up_speed: number;
  downloaded: number;
  uploaded: number;
}

export interface PeersDelta {
  /** Names this list for the next request. */
  cursor: string;
  fullUpdate: boolean;
  /** Whether qBittorrent resolves peer countries; null when it didn't say. */
  showFlags: boolean | null;
  peers: Record<string, Partial<PeerView>>;
  removed: string[];
  /** Whether the torrent is private (null: qBittorrent didn't say); sent with a page's first request only. */
  private?: boolean | null;
}

export interface PeersState {
  cursor: string;
  showFlags: boolean | null;
  peers: Record<string, Partial<PeerView>>;
  private: boolean | null;
}

/** The list after one answer: replaced on a full update, else changed fields merged and departed peers dropped. */
export function mergePeers(previous: PeersState | undefined, delta: PeersDelta): PeersState {
  const peers: Record<string, Partial<PeerView>> = delta.fullUpdate || !previous ? {} : { ...previous.peers };
  for (const key of delta.removed) delete peers[key];
  for (const [key, changed] of Object.entries(delta.peers)) peers[key] = { ...peers[key], ...changed };
  return {
    cursor: delta.cursor,
    showFlags: delta.showFlags,
    peers,
    private: delta.private !== undefined ? delta.private : previous?.private ?? null,
  };
}

/** A country's flag from its ISO 3166-1 alpha-2 code ('' when there is none). */
export function countryFlag(code: string | undefined): string {
  if (!code || !/^[a-z]{2}$/i.test(code)) return '';
  return String.fromCodePoint(...[...code.toUpperCase()].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65));
}

export const PEER_SORTS = [
  { key: 'dl_speed', label: 'Download speed' },
  { key: 'up_speed', label: 'Upload speed' },
  { key: 'progress', label: 'Progress' },
  { key: 'downloaded', label: 'Downloaded' },
  { key: 'uploaded', label: 'Uploaded' },
  { key: 'relevance', label: 'Relevance' },
  { key: 'client', label: 'Client' },
  { key: 'country', label: 'Country' },
] as const;

export type PeerSort = (typeof PEER_SORTS)[number]['key'];

const byName = (a: string | undefined, b: string | undefined) =>
  // Unknown names last.
  a && b ? a.localeCompare(b) : a ? -1 : b ? 1 : 0;

/** A speed in half-octave steps (about 40% each); 0 is below every step. */
function speedStep(bytesPerSecond: number | undefined): number {
  return bytesPerSecond && bytesPerSecond > 0 ? Math.floor(Math.log2(bytesPerSecond) * 2) : -1;
}

/**
 * Numbers biggest first, names A to Z; the key breaks ties so rows don't swap places between polls.
 * `previous`, the keys as last shown under the same speed sort, keeps that
 * order: a peer moves up only past one at least about twice as slow (two
 * steps). Rates swing that much from one poll to the next, and sorted exactly,
 * a busy torrent's rows reshuffled every few seconds. New peers start at the
 * end and rise the same way.
 */
export function sortPeers(
  peers: Record<string, Partial<PeerView>>,
  sort: PeerSort,
  previous?: readonly string[],
): Array<[string, Partial<PeerView>]> {
  if (previous && (sort === 'dl_speed' || sort === 'up_speed')) {
    const kept = previous.filter((key) => Object.hasOwn(peers, key));
    const keptSet = new Set(kept);
    const joined = sortPeers(Object.fromEntries(Object.entries(peers).filter(([key]) => !keptSet.has(key))), sort).map(([key]) => key);
    const keys = [...kept, ...joined];
    const step = (key: string) => speedStep(peers[key][sort]);
    for (let i = 1; i < keys.length; i++) {
      for (let j = i; j > 0 && step(keys[j]) - step(keys[j - 1]) >= 2; j--) [keys[j - 1], keys[j]] = [keys[j], keys[j - 1]];
    }
    return keys.map((key) => [key, peers[key]]);
  }
  return Object.entries(peers).sort(([keyA, a], [keyB, b]) => {
    const order = sort === 'client' || sort === 'country'
      ? byName(a[sort], b[sort])
      : (b[sort] ?? 0) - (a[sort] ?? 0);
    return order || (keyA < keyB ? -1 : keyA > keyB ? 1 : 0);
  });
}
