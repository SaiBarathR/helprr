export interface QBittorrentTorrent {
  hash: string;
  name: string;
  size: number;
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
  magnet_uri: string;
  time_active: number;
  seeding_time: number;
  availability: number;
  ratio: number;
  seq_dl: boolean;
  f_l_piece_prio: boolean;
  force_start: boolean;
  auto_tmm: boolean;
  max_ratio: number;
  max_seeding_time: number;
  private?: boolean;
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

export interface QBittorrentSummaryResponse {
  torrents: QBittorrentTorrent[];
  transferInfo: QBittorrentTransferInfo | null;
  speedLimitsMode?: number;
}
