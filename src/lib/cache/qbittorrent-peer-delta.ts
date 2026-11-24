import { createHash } from 'node:crypto';
import type { PeerView, PeersDelta } from '@/lib/qbittorrent-peer-view';

/*
 * What changed in one torrent's peer list since the list this page holds.
 * Helprr keeps the history and issues the cursor, as for the torrent list
 * (./qbittorrent-delta.ts): qBittorrent's own `rid` can't be trusted here, as
 * it keeps one sync state per Web UI session for every torrent, Helprr uses one
 * session, and any rid=0 request restarts its ids at 1, so a page's rid can
 * name another torrent's (or another user's) list. A cursor is only read back
 * in the scope that made it (user, torrent, and whether addresses are shown);
 * an unknown, evicted or old one gets the full list.
 */

export interface PeerList {
  showFlags: boolean | null;
  peers: Record<string, PeerView>;
}

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 64;
const MAX_AGE_MS = 120_000;
type Snapshot = { scope: string; list: PeerList; bytes: number; at: number };

function diffPeers(previous: PeerList | undefined, current: PeerList, cursor: string): PeersDelta {
  // Fields only go away when qBittorrent stops resolving countries: start over then.
  if (!previous || previous.showFlags !== current.showFlags) {
    return { cursor, fullUpdate: true, showFlags: current.showFlags, peers: current.peers, removed: [] };
  }
  const peers: PeersDelta['peers'] = {};
  for (const [key, peer] of Object.entries(current.peers)) {
    const old = previous.peers[key];
    if (!old) {
      peers[key] = peer;
      continue;
    }
    const changed: Partial<PeerView> = {};
    for (const field of Object.keys(peer) as Array<keyof PeerView>) {
      if (peer[field] !== old[field]) (changed as Record<string, unknown>)[field] = peer[field];
    }
    if (Object.keys(changed).length > 0) peers[key] = changed;
  }
  const removed = Object.keys(previous.peers).filter((key) => !(key in current.peers));
  return { cursor, fullUpdate: false, showFlags: current.showFlags, peers, removed };
}

export class PeerDeltaHistory {
  private snapshots = new Map<string, Snapshot>();
  private bytes = 0;
  constructor(private readonly maxBytes = MAX_BYTES) {}

  response(scope: string, cursor: string | undefined, list: PeerList, now = Date.now()): PeersDelta {
    for (const [key, entry] of this.snapshots) {
      if (now - entry.at > MAX_AGE_MS) this.remove(key);
    }
    const found = cursor ? this.snapshots.get(cursor) : undefined;
    const previous = found?.scope === scope ? found.list : undefined;
    const json = JSON.stringify(list);
    const nextCursor = createHash('sha256').update(scope).update('\0').update(json).digest('hex');
    const result = diffPeers(previous, list, nextCursor);
    this.remove(nextCursor);
    const bytes = Buffer.byteLength(json);
    if (bytes <= this.maxBytes) {
      this.snapshots.set(nextCursor, { scope, list, bytes, at: now });
      this.bytes += bytes;
      while (this.bytes > this.maxBytes || this.snapshots.size > MAX_ENTRIES) this.remove(this.snapshots.keys().next().value!);
    }
    return result;
  }

  private remove(key: string) {
    const entry = this.snapshots.get(key);
    if (entry) this.bytes -= entry.bytes;
    this.snapshots.delete(key);
  }
}

const shared = globalThis as typeof globalThis & { __helprrPeerDelta?: PeerDeltaHistory };
export const peerDeltaHistory = shared.__helprrPeerDelta ??= new PeerDeltaHistory();
