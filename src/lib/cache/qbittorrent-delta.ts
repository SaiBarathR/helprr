import { createHash } from 'node:crypto';
import type { QBittorrentSummaryResponse } from '@/types';
import { diffTorrentSummary } from '@/lib/qbittorrent-delta';

// Server-owned history, never an upstream cursor. Unknown/evicted cursors reset.
// A request can only refer to history in its authenticated user/filter/version
// scope. Bound memory and lifetime even with many users, filters and tabs.
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 64;
const MAX_AGE_MS = 60_000;
type Snapshot = { scope: string; payload: QBittorrentSummaryResponse; bytes: number; at: number };
export class TorrentDeltaHistory {
  private snapshots = new Map<string, Snapshot>();
  private bytes = 0;
  constructor(private readonly maxBytes = MAX_BYTES) {}
  response(scope: string, cursor: string | undefined, payload: QBittorrentSummaryResponse, now = Date.now()) {
    for (const [key, entry] of this.snapshots) {
      if (now - entry.at > MAX_AGE_MS) this.remove(key);
    }
    const found = cursor ? this.snapshots.get(cursor) : undefined;
    const previous = found?.scope === scope ? found.payload : undefined;
    const json = JSON.stringify(payload);
    const nextCursor = createHash('sha256').update(scope).update('\0').update(json).digest('hex');
    const result = diffTorrentSummary(previous, payload, nextCursor);
    this.remove(nextCursor);
    const bytes = Buffer.byteLength(json);
    if (bytes <= this.maxBytes) {
      this.snapshots.set(nextCursor, { scope, payload, bytes, at: now });
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
const shared = globalThis as typeof globalThis & { __helprrTorrentDelta?: TorrentDeltaHistory };
export const torrentDeltaHistory = shared.__helprrTorrentDelta ??= new TorrentDeltaHistory();
