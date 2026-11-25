import type { QBittorrentClient } from '@/lib/qbittorrent-client';
import { normalizeTransferInfo } from '@/lib/qbittorrent-summary';
import { NotServiceApiError } from '@/lib/service-response';
import type { QBittorrentServerStats, QBittorrentTorrentInfo, QBittorrentTransferInfo } from '@/types';

/**
 * qBittorrent's sync/maindata, merged on the server: the one read of the
 * torrent list, transfer figures and alternative speed mode behind the
 * torrents summary, the server stats and the background poll. After the first
 * full answer qBittorrent sends only what changed since the response id (rid)
 * it last gave, so every poll costs a few hundred bytes instead of the whole
 * list.
 *
 * qBittorrent keeps one rid per Web UI session and does not check it strictly:
 * a repeated older rid is answered with the changes since its LAST response
 * (checked on 5.1.4), so two overlapping reads would each miss what the other
 * got. Reads are therefore chained one after another, never concurrent, and
 * any failure (including a timeout qBittorrent may have answered) starts the
 * next read from rid 0, a full update. A new session (sign-in again after a
 * restart or an expired cookie) doesn't know the rid and answers in full too.
 *
 * What is kept holds magnets, tracker URLs (passkeys) and the public IP in
 * server_state: it never leaves the server as it is. Browsers get the
 * torrents through projectTorrentForSummary and the figures through
 * normalizeTransferInfo or serverStatsFrom; the trackers map isn't kept.
 */

/** Matches the summary's old 2 s cache: one upstream read per window, however many tabs poll. */
export const QBITTORRENT_SYNC_MAX_AGE_MS = 2_000;

type Row = Record<string, unknown>;

export interface QBittorrentSyncSnapshot {
  /** In qBittorrent's order, new torrents last. Each row is replaced, never changed in place. */
  torrents: QBittorrentTorrentInfo[];
  /** Null when qBittorrent sent none. */
  serverState: Row | null;
}

const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);

export class QBittorrentSync {
  private rid = 0;
  private torrents = new Map<string, QBittorrentTorrentInfo>();
  private serverState: Row | null = null;
  private snapshot: QBittorrentSyncSnapshot | null = null;
  private syncedAt = 0;
  /** The cache version the kept state was read under (getQbitCacheVersion). */
  private version: number | undefined;
  private inflight: { promise: Promise<QBittorrentSyncSnapshot>; version: number | undefined } | null = null;

  constructor(readonly client: QBittorrentClient, private readonly now: () => number = Date.now) {}

  /**
   * The merged state, read again when older than maxAgeMs. A version (bumped
   * after every Helprr action on qBittorrent) newer than the kept state's
   * forces a read, so a refetch right after an action never sees the state
   * from before it; the poll passes none.
   */
  read(maxAgeMs = QBITTORRENT_SYNC_MAX_AGE_MS, version?: number): Promise<QBittorrentSyncSnapshot> {
    const versionOk = version === undefined || version === this.version;
    if (this.snapshot && versionOk && this.now() - this.syncedAt < maxAgeMs) return Promise.resolve(this.snapshot);
    // A read already on its way for this version serves this caller too; one
    // for an older version may predate the action, so a new read queues after it.
    if (this.inflight && (version === undefined || this.inflight.version === version)) return this.inflight.promise;
    const previous = this.inflight?.promise;
    const promise = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(() => this.pull(version));
    const entry = { promise, version };
    this.inflight = entry;
    const clear = () => {
      if (this.inflight === entry) this.inflight = null;
    };
    promise.then(clear, clear);
    return promise;
  }

  private async pull(version: number | undefined): Promise<QBittorrentSyncSnapshot> {
    const sentRid = this.rid;
    let data: unknown;
    try {
      data = await this.client.getMaindata(sentRid);
      if (!isRow(data) || typeof data.rid !== 'number' || !Number.isInteger(data.rid)) throw new NotServiceApiError();
    } catch (error) {
      this.rid = 0;
      throw error;
    }
    this.apply(data, sentRid === 0 || data.full_update === true);
    this.rid = data.rid as number;
    this.syncedAt = this.now();
    this.version = version ?? this.version;
    this.snapshot = { torrents: [...this.torrents.values()], serverState: this.serverState };
    return this.snapshot;
  }

  private apply(data: Row, full: boolean) {
    const changed = isRow(data.torrents) ? data.torrents : {};
    if (full) {
      this.torrents = new Map();
      this.serverState = isRow(data.server_state) ? { ...data.server_state } : null;
    } else {
      if (Array.isArray(data.torrents_removed)) {
        for (const hash of data.torrents_removed) if (typeof hash === 'string') this.torrents.delete(hash);
      }
      if (isRow(data.server_state)) this.serverState = { ...this.serverState, ...data.server_state };
    }
    for (const [hash, fields] of Object.entries(changed)) {
      if (!isRow(fields)) continue;
      // The key is the hash; maindata rows carry none of their own.
      this.torrents.set(hash, { ...this.torrents.get(hash), ...fields, hash } as QBittorrentTorrentInfo);
    }
  }
}

/** transfer/info's eight shown figures (server_state has the same names), or null without server_state. */
export function transferInfoFrom(serverState: Row | null): QBittorrentTransferInfo | null {
  return serverState ? normalizeTransferInfo(serverState as unknown as QBittorrentTransferInfo) : null;
}

/** qBittorrent's alternative speed mode as transfer/speedLimitsMode reports it: 1 on, 0 off. */
export function speedLimitsModeFrom(serverState: Row | null): number {
  return serverState?.use_alt_speed_limits === true ? 1 : 0;
}

/**
 * All-time totals and free disk space, copied out field by field so nothing
 * else in server_state (the public IP) reaches a browser.
 */
export function serverStatsFrom(serverState: Row | null): QBittorrentServerStats {
  if (!serverState) throw new NotServiceApiError();
  const { free_space_on_disk, alltime_dl, alltime_ul, global_ratio } = serverState;
  const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);
  const downloaded = count(alltime_dl);
  const uploaded = count(alltime_ul);
  // qBittorrent sends the ratio as text in the host's locale ("1.43", "1,43",
  // or "-" before any data): when it doesn't parse, work it out from the totals.
  const sent = typeof global_ratio === 'string' && global_ratio.trim() !== '' ? count(Number(global_ratio)) : count(global_ratio);
  const derived = downloaded && uploaded !== null ? Math.round((uploaded / downloaded) * 100) / 100 : null;
  return {
    freeSpaceOnDisk: count(free_space_on_disk),
    alltimeDownloaded: downloaded,
    alltimeUploaded: uploaded,
    globalRatio: sent ?? derived,
  };
}

// On globalThis, not in module scope: the routes and the background poll
// (started from instrumentation) can load separate copies of this module, and
// they should share one rid. One per qBittorrent instance (client.instanceId),
// so two qBittorrents never merge into one list; a changed URL or password
// makes a new client, and so a new state for that instance.
const shared = globalThis as typeof globalThis & { __helprrQbitSyncs?: Map<string, QBittorrentSync> };

function syncs(): Map<string, QBittorrentSync> {
  return (shared.__helprrQbitSyncs ??= new Map());
}

/** The merged state for this client's instance and connection (connectionKey), made on first use. */
export function qbittorrentSyncFor(client: QBittorrentClient): QBittorrentSync {
  const key = client.instanceId ?? '';
  const current = syncs().get(key);
  if (current && (current.client === client || (!!client.connectionKey && current.client.connectionKey === client.connectionKey))) return current;
  const sync = new QBittorrentSync(client);
  syncs().set(key, sync);
  return sync;
}

/** Let go of the state of instances that are no longer connected (it holds their whole torrent list). */
export function forgetQBittorrentSyncsExcept(instanceIds: Iterable<string>) {
  const keep = new Set(instanceIds);
  for (const key of syncs().keys()) if (!keep.has(key)) syncs().delete(key);
}

export function resetQBittorrentSyncForTests() {
  syncs().clear();
}
