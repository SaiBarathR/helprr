import type { QBittorrentTorrent, QBittorrentTransferInfo } from '@/types';

export type ProjectedTorrentSummary = QBittorrentTorrent;

export function projectTorrentForSummary(torrent: QBittorrentTorrent): ProjectedTorrentSummary {
  return {
    hash: torrent.hash,
    name: torrent.name,
    size: torrent.size,
    progress: torrent.progress,
    dlspeed: torrent.dlspeed,
    upspeed: torrent.upspeed,
    num_seeds: torrent.num_seeds,
    num_leechs: torrent.num_leechs,
    state: torrent.state,
    eta: torrent.eta,
    category: torrent.category,
    tags: torrent.tags,
    priority: torrent.priority,
    added_on: torrent.added_on,
    completion_on: torrent.completion_on,
    save_path: torrent.save_path,
    amount_left: torrent.amount_left,
    completed: torrent.completed,
    downloaded: torrent.downloaded,
    uploaded: torrent.uploaded,
    downloaded_session: torrent.downloaded_session,
    uploaded_session: torrent.uploaded_session,
    dl_limit: torrent.dl_limit,
    up_limit: torrent.up_limit,
    magnet_uri: torrent.magnet_uri,
    time_active: torrent.time_active,
    seeding_time: torrent.seeding_time,
    availability: torrent.availability,
    ratio: torrent.ratio,
    seq_dl: torrent.seq_dl,
    f_l_piece_prio: torrent.f_l_piece_prio,
    force_start: torrent.force_start,
    auto_tmm: torrent.auto_tmm,
    max_ratio: torrent.max_ratio,
    max_seeding_time: torrent.max_seeding_time,
    private: torrent.private,
    tracker: torrent.tracker,
  };
}

export function projectTorrentsForSummary(torrents: QBittorrentTorrent[]): ProjectedTorrentSummary[] {
  return torrents.map(projectTorrentForSummary);
}

export function normalizeTransferInfo(info: QBittorrentTransferInfo): QBittorrentTransferInfo {
  return {
    dl_info_speed: info.dl_info_speed,
    dl_info_data: info.dl_info_data,
    up_info_speed: info.up_info_speed,
    up_info_data: info.up_info_data,
    dl_rate_limit: info.dl_rate_limit,
    up_rate_limit: info.up_rate_limit,
    dht_nodes: info.dht_nodes,
    connection_status: info.connection_status,
  };
}

export function passiveTorrentRefreshIntervalMs(baseMs: number, connection?: { saveData?: boolean; effectiveType?: string } | null): number {
  if (!connection?.saveData && connection?.effectiveType !== 'slow-2g' && connection?.effectiveType !== '2g') {
    return baseMs;
  }
  return Math.max(baseMs * 3, 15_000);
}

export function torrentCounters(torrents: QBittorrentTorrent[]) {
  let downloading = 0, seeding = 0, paused = 0;
  for (const torrent of torrents) {
    const state = torrent.state.toLowerCase();
    if (['downloading', 'metadl', 'forcedmetadl', 'queueddl', 'checkingdl', 'forceddl', 'allocating', 'stalleddl'].includes(state)) downloading++;
    else if (['uploading', 'stalledup', 'queuedup', 'checkingup', 'forcedup'].includes(state)) seeding++;
    else if (['paused', 'pauseddl', 'pausedup', 'stoppeddl', 'stoppedup'].includes(state)) paused++;
  }
  return { total: torrents.length, downloading, seeding, paused };
}
