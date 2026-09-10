import type { QBittorrentSummaryResponse, QBittorrentTorrent } from '@/types';

export interface TorrentDeltaResponse {
  cursor: string;
  reset: boolean;
  changed: Array<Partial<QBittorrentTorrent> & Pick<QBittorrentTorrent, 'hash'>>;
  removed: string[];
  cleared?: Record<string, Array<keyof QBittorrentTorrent>>;
  order?: string[];
  transferInfo: QBittorrentSummaryResponse['transferInfo'];
  speedLimitsMode: QBittorrentSummaryResponse['speedLimitsMode'];
}

export function diffTorrentSummary(previous: QBittorrentSummaryResponse | undefined, current: QBittorrentSummaryResponse, cursor: string): TorrentDeltaResponse {
  const before = new Map(previous?.torrents.map(row => [row.hash, row]));
  const changed: TorrentDeltaResponse['changed'] = [];
  const cleared: NonNullable<TorrentDeltaResponse['cleared']> = {};
  for (const row of current.torrents) {
    const old = before.get(row.hash);
    if (!old) changed.push(row);
    else {
      const patch: Record<string, unknown> = { hash: row.hash };
      for (const key of new Set([...Object.keys(old), ...Object.keys(row)]) as Set<keyof QBittorrentTorrent>) {
        if (row[key] !== old[key]) {
          if (row[key] === undefined) (cleared[row.hash] ??= []).push(key);
          else patch[key] = row[key];
        }
      }
      if (Object.keys(patch).length > 1) changed.push(patch as TorrentDeltaResponse['changed'][number]);
    }
    before.delete(row.hash);
  }
  const order = current.torrents.map(row => row.hash);
  const orderChanged = !previous || order.length !== previous.torrents.length || order.some((hash, i) => previous.torrents[i]?.hash !== hash);
  return { cursor, reset: !previous, changed, removed: [...before.keys()], ...(Object.keys(cleared).length ? { cleared } : {}), ...(orderChanged ? { order } : {}), transferInfo: current.transferInfo, speedLimitsMode: current.speedLimitsMode };
}

export function applyTorrentDelta(previous: QBittorrentSummaryResponse | undefined, delta: TorrentDeltaResponse): QBittorrentSummaryResponse {
  if (!delta.reset && !previous) throw new Error('Missing torrent snapshot');
  const rows = new Map((delta.reset ? [] : previous?.torrents ?? []).map(row => [row.hash, row]));
  for (const hash of delta.removed) rows.delete(hash);
  for (const [hash, fields] of Object.entries(delta.cleared ?? {})) {
    const old = rows.get(hash);
    if (old) {
      const row = { ...old };
      for (const key of fields) delete (row as Partial<QBittorrentTorrent>)[key];
      rows.set(hash, row);
    }
  }
  for (const patch of delta.changed) rows.set(patch.hash, { ...rows.get(patch.hash), ...patch } as QBittorrentTorrent);
  const torrents = delta.order ? delta.order.map(hash => {
    const row = rows.get(hash);
    if (!row) throw new Error('Incomplete torrent snapshot');
    return row;
  }) : [...rows.values()];
  return { torrents, transferInfo: delta.transferInfo, speedLimitsMode: delta.speedLimitsMode };
}
