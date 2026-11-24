/*
 * The peers list as the browser holds it (no imports, so the page can use it).
 * The server sends qBittorrent's sync/torrentPeers answer keyed by an opaque
 * key per peer (src/lib/qbittorrent-peers.ts): a full list, or since the last
 * `rid` only the fields that changed and the keys of peers that left.
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
  rid: number;
  fullUpdate: boolean;
  /** Whether qBittorrent resolves peer countries; null when it didn't say. */
  showFlags: boolean | null;
  peers: Record<string, Partial<PeerView>>;
  removed: string[];
}

export interface PeersState {
  rid: number;
  showFlags: boolean | null;
  peers: Record<string, Partial<PeerView>>;
}

/** The list after one answer: replaced on a full update, else changed fields merged and departed peers dropped. */
export function mergePeers(previous: PeersState | undefined, delta: PeersDelta): PeersState {
  const peers: Record<string, Partial<PeerView>> = delta.fullUpdate || !previous ? {} : { ...previous.peers };
  for (const key of delta.removed) delete peers[key];
  for (const [key, changed] of Object.entries(delta.peers)) peers[key] = { ...peers[key], ...changed };
  return {
    rid: delta.rid,
    // A delta leaves show_flags out unless it changed.
    showFlags: delta.showFlags ?? previous?.showFlags ?? null,
    peers,
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

/** Numbers biggest first, names A to Z; the key breaks ties so rows don't swap places between polls. */
export function sortPeers(peers: Record<string, Partial<PeerView>>, sort: PeerSort): Array<[string, Partial<PeerView>]> {
  return Object.entries(peers).sort(([keyA, a], [keyB, b]) => {
    const order = sort === 'client' || sort === 'country'
      ? byName(a[sort], b[sort])
      : (b[sort] ?? 0) - (a[sort] ?? 0);
    return order || (keyA < keyB ? -1 : keyA > keyB ? 1 : 0);
  });
}
