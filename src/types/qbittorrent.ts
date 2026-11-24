export interface QBittorrentTorrent {
  hash: string;
  name: string;
  size: number;
  total_size?: number;
  progress: number;
  dlspeed: number;
  upspeed: number;
  num_seeds: number;
  num_leechs: number;
  state: string;
  eta: number;
  category: string;
  tags: string;
  priority: number;
  added_on: number;
  completion_on: number;
  save_path: string;
  amount_left: number;
  completed: number;
  downloaded: number;
  uploaded: number;
  downloaded_session: number;
  uploaded_session: number;
  dl_limit: number;
  up_limit: number;
  time_active: number;
  seeding_time: number;
  availability: number;
  ratio: number;
  seq_dl: boolean;
  f_l_piece_prio: boolean;
  force_start: boolean;
  auto_tmm: boolean;
  /** The limits in force: the torrent's own, or the global one while it uses that (-1: none). */
  max_ratio: number;
  /** Minutes, like the limits below. */
  max_seeding_time: number;
  max_inactive_seeding_time?: number;
  /** What the torrent itself is set to: -2 uses the global limit, -1 is unlimited. Times are minutes. */
  ratio_limit?: number;
  seeding_time_limit?: number;
  inactive_seeding_time_limit?: number;
  private?: boolean;
}

/**
 * A torrent as qBittorrent's torrents/info answers. The magnet's `tr=` and the
 * tracker URL can carry a private tracker's passkey, so they stay on the
 * server: what reaches a browser is a QBittorrentTorrent
 * (projectTorrentForSummary), and the details route hands out the magnet a
 * user may copy (src/lib/qbittorrent-tracker-links.ts).
 */
export interface QBittorrentTorrentInfo extends QBittorrentTorrent {
  magnet_uri: string;
  /** Current working tracker URL (empty when qBittorrent has none active). */
  tracker?: string;
}

export interface QBittorrentTransferInfo {
  dl_info_speed: number;
  dl_info_data: number;
  up_info_speed: number;
  up_info_data: number;
  dl_rate_limit: number;
  up_rate_limit: number;
  dht_nodes: number;
  connection_status: string;
}

/** qBittorrent's all-time totals and free disk space (sync/maindata server_state). */
export interface QBittorrentServerStats {
  /** Bytes free where qBittorrent saves; null when qBittorrent can't tell (it reports -1). */
  freeSpaceOnDisk: number | null;
  alltimeDownloaded: number | null;
  alltimeUploaded: number | null;
  globalRatio: number | null;
}

export interface QBittorrentSummaryResponse {
  torrents: QBittorrentTorrent[];
  transferInfo: QBittorrentTransferInfo | null;
  speedLimitsMode?: number;
}
