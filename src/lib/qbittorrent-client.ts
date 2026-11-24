import axios, { AxiosInstance } from 'axios';
import { keepAliveHttpAgent, keepAliveHttpsAgent } from '@/lib/http-agents';
import { refuseRedirectToAnotherHost } from '@/lib/redirect-guard';
import { NotServiceApiError } from '@/lib/service-response';
import { normalizeTransferInfo } from '@/lib/qbittorrent-summary';
import type { QBittorrentServerStats, QBittorrentTorrentInfo, QBittorrentTransferInfo } from '@/types';

/** qBittorrent turned the Web UI username or password down (it answered "Fails."). */
export class QBittorrentLoginError extends Error {}

export interface TorrentFile {
  index: number;
  name: string;
  size: number;
  progress: number;
  priority: number;
  is_seed: boolean;
  availability: number;
}

export interface TorrentTracker {
  url: string;
  status: number;
  tier: number;
  num_peers: number;
  num_seeds: number;
  num_leeches: number;
  num_downloaded: number;
  msg: string;
}

export interface QBittorrentCategory {
  name: string;
  /** Empty: qBittorrent's default save path plus the name (in subcategory mode, the parent's folder plus the last part). */
  savePath: string;
  /** qBittorrent 5: its own incomplete-downloads folder, false for none, absent or null for the global setting. */
  download_path?: string | false | null;
}

/** qBittorrent's settings for where torrents save (getSavePathPreferences). */
export interface SavePathPreferences {
  /** "Use subcategories": "a/b" is then a child of "a". */
  subcategories: boolean;
  /** "Default Torrent Management Mode" is Automatic. */
  autoTmmByDefault: boolean | null;
  /** "Use Category paths in Manual Mode". */
  categoryPathsInManualMode: boolean | null;
  /** "When Category Save Path changed" is Relocate (else: switch to manual). */
  relocateOnCategoryPathChange: boolean | null;
}

export type QueueMove = 'topPrio' | 'increasePrio' | 'decreasePrio' | 'bottomPrio';

export type ContentLayout = 'Original' | 'Subfolder' | 'NoSubfolder';

/** The torrents/add options beyond category, save path and start/stop; each is sent only when set. */
export interface AddTorrentOptions {
  tags?: string[];
  /** The torrent's name in qBittorrent; the files keep theirs. */
  rename?: string;
  sequentialDownload?: boolean;
  firstLastPiecePrio?: boolean;
  autoTMM?: boolean;
  contentLayout?: ContentLayout;
  skipChecking?: boolean;
  addToTopOfQueue?: boolean;
  /** Bytes per second. */
  dlLimit?: number;
  upLimit?: number;
}

// qBittorrent's own field names (checked against 5.1.4); booleans go as "true"/"false".
function appendAddOptions(append: (key: string, value: string) => void, options: AddTorrentOptions): void {
  if (options.tags?.length) append('tags', options.tags.join(','));
  if (options.rename) append('rename', options.rename);
  if (options.sequentialDownload !== undefined) append('sequentialDownload', String(options.sequentialDownload));
  if (options.firstLastPiecePrio !== undefined) append('firstLastPiecePrio', String(options.firstLastPiecePrio));
  if (options.autoTMM !== undefined) append('autoTMM', String(options.autoTMM));
  if (options.contentLayout) append('contentLayout', options.contentLayout);
  if (options.skipChecking !== undefined) append('skip_checking', String(options.skipChecking));
  if (options.addToTopOfQueue !== undefined) append('addToTopOfQueue', String(options.addToTopOfQueue));
  if (options.dlLimit) append('dlLimit', String(options.dlLimit));
  if (options.upLimit) append('upLimit', String(options.upLimit));
}

/** qBittorrent's regular and alternative-mode speed limits, in bytes per second (0 = unlimited). */
export const SPEED_LIMIT_PREFERENCES = ['dl_limit', 'up_limit', 'alt_dl_limit', 'alt_up_limit'] as const;
export type SpeedLimitPreference = (typeof SPEED_LIMIT_PREFERENCES)[number];
export type SpeedLimits = Record<SpeedLimitPreference, number>;

interface TorrentProperties {
  save_path: string;
  creation_date: number;
  piece_size: number;
  comment: string;
  total_wasted: number;
  total_uploaded: number;
  total_downloaded: number;
  up_limit: number;
  dl_limit: number;
  time_elapsed: number;
  seeding_time: number;
  nb_connections: number;
  share_ratio: number;
  addition_date: number;
  completion_date: number;
  created_by: string;
  dl_speed_avg: number;
  dl_speed: number;
  eta: number;
  last_seen: number;
  peers: number;
  peers_total: number;
  pieces_have: number;
  pieces_num: number;
  reannounce: number;
  seeds: number;
  seeds_total: number;
  total_size: number;
  up_speed_avg: number;
  up_speed: number;
}

export class QBittorrentClient {
  private client: AxiosInstance;
  private baseUrl: string;
  private username: string;
  private password: string;
  private cookie: string | null = null;
  private authPromise: Promise<void> | null = null;
  private torrentControlMode: 'unknown' | 'startStop' | 'pauseResume' = 'unknown';

  constructor(url: string, password: string, username: string = 'admin', customHeaders?: Record<string, string>) {
    this.baseUrl = url.replace(/\/+$/, '');
    this.username = username;
    this.password = password;

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        ...customHeaders,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 30_000,
      // Keep-alive socket pooling — orthogonal to the cookie auth flow below,
      // which sets headers/cookies per request regardless of the underlying socket.
      httpAgent: keepAliveHttpAgent,
      httpsAgent: keepAliveHttpsAgent,
      beforeRedirect: refuseRedirectToAnotherHost,
    });
  }

  private async ensureAuthenticated(): Promise<void> {
    if (this.cookie) return;

    if (this.authPromise) {
      await this.authPromise;
      return;
    }

    this.authPromise = this.login();
    try {
      await this.authPromise;
    } finally {
      this.authPromise = null;
    }
  }

  private async login(): Promise<void> {
    const params = new URLSearchParams();
    params.append('username', this.username);
    params.append('password', this.password);

    const response = await this.client.post('/api/v2/auth/login', params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const setCookieHeader = response.headers['set-cookie'];
    if (setCookieHeader) {
      const sidMatch = setCookieHeader
        .map((c: string) => c.match(/SID=([^;]+)/))
        .find((m: RegExpMatchArray | null) => m !== null);
      if (sidMatch) {
        this.cookie = `SID=${sidMatch[1]}`;
      }
    }

    if (!this.cookie) {
      // "Fails." is qBittorrent refusing the username or password. Anything else with no
      // session is not qBittorrent's sign-in (a sign-in page, the wrong port).
      const body = typeof response.data === 'string' ? response.data.trim() : '';
      if (body === 'Fails.') throw new QBittorrentLoginError('qBittorrent authentication failed: wrong username or password');
      if (body === 'Ok.') throw new Error('qBittorrent authentication failed: no SID cookie received');
      throw new NotServiceApiError();
    }
  }

  private async get<T>(endpoint: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    await this.ensureAuthenticated();
    try {
      const response = await this.client.get<T>(endpoint, {
        params,
        signal,
        headers: { Cookie: this.cookie! },
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        this.cookie = null;
        await this.ensureAuthenticated();
        const response = await this.client.get<T>(endpoint, {
          params,
        signal,
          headers: { Cookie: this.cookie! },
        });
        return response.data;
      }
      throw error;
    }
  }

  private async post<T>(endpoint: string, data?: string): Promise<T> {
    await this.ensureAuthenticated();
    try {
      const response = await this.client.post<T>(endpoint, data, {
        headers: {
          Cookie: this.cookie!,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        this.cookie = null;
        await this.ensureAuthenticated();
        const response = await this.client.post<T>(endpoint, data, {
          headers: {
            Cookie: this.cookie!,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        });
        return response.data;
      }
      throw error;
    }
  }

  private async postMultipart<T>(endpoint: string, formData: FormData): Promise<T> {
    await this.ensureAuthenticated();
    const response = await this.client.post<T>(endpoint, formData, {
      headers: {
        Cookie: this.cookie!,
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  }

  // Torrents
  async getTorrents(
    filter?: string,
    category?: string,
    sort?: string,
    reverse?: boolean,
    hashes?: string,
    signal?: AbortSignal
  ): Promise<QBittorrentTorrentInfo[]> {
    const params: Record<string, unknown> = {};
    if (filter !== undefined) params.filter = filter;
    if (category !== undefined) params.category = category;
    if (sort !== undefined) params.sort = sort;
    if (reverse !== undefined) params.reverse = reverse;
    if (hashes !== undefined) params.hashes = hashes;
    return this.get<QBittorrentTorrentInfo[]>('/api/v2/torrents/info', params, signal);
  }

  async getTorrentProperties(hash: string, signal?: AbortSignal): Promise<TorrentProperties> {
    return this.get<TorrentProperties>('/api/v2/torrents/properties', { hash }, signal);
  }

  async getTorrentFiles(hash: string, signal?: AbortSignal): Promise<TorrentFile[]> {
    return this.get<TorrentFile[]>('/api/v2/torrents/files', { hash }, signal);
  }

  async getTorrentTrackers(hash: string, signal?: AbortSignal): Promise<TorrentTracker[]> {
    return this.get<TorrentTracker[]>('/api/v2/torrents/trackers', { hash }, signal);
  }

  private isNotFound(error: unknown): boolean {
    return axios.isAxiosError(error) && error.response?.status === 404;
  }

  private async postTorrentControlAction(hashes: string, action: 'start' | 'stop'): Promise<void> {
    const params = new URLSearchParams();
    params.append('hashes', hashes);
    const body = params.toString();

    const endpoints = action === 'start'
      ? { startStop: '/api/v2/torrents/start', pauseResume: '/api/v2/torrents/resume' }
      : { startStop: '/api/v2/torrents/stop', pauseResume: '/api/v2/torrents/pause' };

    const modesToTry: Array<'startStop' | 'pauseResume'> =
      this.torrentControlMode === 'unknown'
        ? ['startStop', 'pauseResume']
        : this.torrentControlMode === 'startStop'
          ? ['startStop', 'pauseResume']
          : ['pauseResume', 'startStop'];

    for (let i = 0; i < modesToTry.length; i++) {
      const mode = modesToTry[i];
      try {
        await this.post(endpoints[mode], body);
        this.torrentControlMode = mode;
        return;
      } catch (error) {
        const canFallback = i === 0 && this.isNotFound(error);
        if (!canFallback) throw error;
      }
    }
  }

  async pauseTorrent(hashes: string): Promise<void> {
    await this.postTorrentControlAction(hashes, 'stop');
  }

  async resumeTorrent(hashes: string): Promise<void> {
    await this.postTorrentControlAction(hashes, 'start');
  }

  async forceStartTorrent(hashes: string, value: boolean = true): Promise<void> {
    const params = new URLSearchParams();
    params.append('hashes', hashes);
    params.append('value', String(value));
    await this.post('/api/v2/torrents/setForceStart', params.toString());
  }

  async deleteTorrent(hashes: string, deleteFiles: boolean = false): Promise<void> {
    const params = new URLSearchParams();
    params.append('hashes', hashes);
    params.append('deleteFiles', String(deleteFiles));
    await this.post('/api/v2/torrents/delete', params.toString());
  }

  async setFilePriority(hash: string, fileIds: number[], priority: 0 | 1 | 6 | 7): Promise<void> {
    const params = new URLSearchParams();
    params.append('hash', hash);
    params.append('id', fileIds.join('|'));
    params.append('priority', String(priority));
    await this.post('/api/v2/torrents/filePrio', params.toString());
  }

  async addMagnet(urls: string, options?: AddTorrentOptions & { category?: string; savepath?: string; paused?: boolean; stopCondition?: 'MetadataReceived' | 'FilesChecked' }): Promise<string> {
    const params = new URLSearchParams();
    params.append('urls', urls);
    if (options?.category) params.append('category', options.category);
    if (options?.savepath) params.append('savepath', options.savepath);
    // Auto-stop after metadata fetch (qBittorrent 4.6+; ignored by older versions).
    if (options?.stopCondition) params.append('stopCondition', options.stopCondition);
    if (options?.paused !== undefined) {
      // qBittorrent 5 renamed the param to "stopped"; send both, unknown params are ignored.
      params.append('paused', String(options.paused));
      params.append('stopped', String(options.paused));
    }
    if (options) appendAddOptions((key, value) => params.append(key, value), options);
    return this.post<string>('/api/v2/torrents/add', params.toString());
  }

  async addTorrentFile(fileBuffer: Uint8Array<ArrayBuffer>, filename: string, options?: AddTorrentOptions & { category?: string; savepath?: string; paused?: boolean }): Promise<void> {
    const formData = new FormData();
    // Pass the view itself, not .buffer — a view over a pooled/offset buffer would
    // otherwise upload the whole backing allocation instead of the file bytes.
    const blob = new Blob([fileBuffer], { type: 'application/x-bittorrent' });
    formData.append('torrents', blob, filename);
    if (options?.category) formData.append('category', options.category);
    if (options?.savepath) formData.append('savepath', options.savepath);
    if (options?.paused !== undefined) {
      // qBittorrent 5 renamed the param to "stopped"; send both, unknown params are ignored.
      formData.append('paused', String(options.paused));
      formData.append('stopped', String(options.paused));
    }
    if (options) appendAddOptions((key, value) => formData.append(key, value), options);
    await this.postMultipart('/api/v2/torrents/add', formData);
  }

  /**
   * The full path of each folder in `dirPath` (qBittorrent 5; hidden ones are
   * left out, and symbolic links are followed). qBittorrent answers 404 when
   * the folder is not there, and an older one 404s the endpoint itself.
   */
  async getDirectoryContent(dirPath: string): Promise<unknown> {
    return this.get<unknown>('/api/v2/app/getDirectoryContent', { dirPath, mode: 'dirs' });
  }

  async getCategories(): Promise<Record<string, QBittorrentCategory>> {
    return this.get('/api/v2/torrents/categories');
  }

  /** An empty save path is qBittorrent's default: <default save path>/<name>. */
  async createCategory(name: string, savePath: string): Promise<void> {
    const params = new URLSearchParams();
    params.append('category', name);
    params.append('savePath', savePath);
    await this.post('/api/v2/torrents/createCategory', params.toString());
  }

  /**
   * qBittorrent 5 resets a category's download path to the global one when
   * editCategory leaves downloadPathEnabled out, so the category's own
   * (`download_path` as categories reports it) is sent back unchanged.
   */
  async editCategory(name: string, savePath: string, downloadPath: QBittorrentCategory['download_path']): Promise<void> {
    const params = new URLSearchParams();
    params.append('category', name);
    params.append('savePath', savePath);
    if (typeof downloadPath === 'string') {
      params.append('downloadPathEnabled', 'true');
      params.append('downloadPath', downloadPath);
    } else if (downloadPath === false) {
      params.append('downloadPathEnabled', 'false');
    }
    await this.post('/api/v2/torrents/editCategory', params.toString());
  }

  /** Its torrents lose the category (their files stay); in subcategory mode its subcategories go too. */
  async removeCategories(names: string[]): Promise<void> {
    if (names.length === 0) throw new Error('removeCategories needs at least one category');
    const params = new URLSearchParams();
    params.append('categories', names.join('\n'));
    await this.post('/api/v2/torrents/removeCategories', params.toString());
  }

  /** qBittorrent's "Use subcategories": "a/b" is then a child of "a". */
  async isSubcategoriesEnabled(): Promise<boolean> {
    const preferences = await this.get<{ use_subcategories?: unknown }>('/api/v2/app/preferences');
    return preferences.use_subcategories === true;
  }

  /**
   * The preferences that decide where a torrent saves, copied out one by one:
   * app/preferences also carries the Web UI and proxy passwords. null where
   * qBittorrent doesn't send one (an older version).
   */
  async getSavePathPreferences(): Promise<SavePathPreferences> {
    const preferences = await this.get<Record<string, unknown>>('/api/v2/app/preferences');
    const flag = (value: unknown) => (typeof value === 'boolean' ? value : null);
    return {
      subcategories: preferences.use_subcategories === true,
      autoTmmByDefault: flag(preferences.auto_tmm_enabled),
      categoryPathsInManualMode: flag(preferences.use_category_paths_in_manual_mode),
      // qBittorrent's "When Category Save Path changed": true relocates the
      // category's automatically managed torrents, false switches them to manual.
      relocateOnCategoryPathChange: flag(preferences.category_changed_tmm_enabled),
    };
  }

  async getDefaultSavePath(): Promise<string> {
    return this.get<string>('/api/v2/app/defaultSavePath');
  }

  // Per-torrent speed limits
  async setTorrentDownloadLimit(hashes: string, limit: number): Promise<void> {
    const params = new URLSearchParams();
    params.append('hashes', hashes);
    params.append('limit', String(limit));
    await this.post('/api/v2/torrents/setDownloadLimit', params.toString());
  }

  async setTorrentUploadLimit(hashes: string, limit: number): Promise<void> {
    const params = new URLSearchParams();
    params.append('hashes', hashes);
    params.append('limit', String(limit));
    await this.post('/api/v2/torrents/setUploadLimit', params.toString());
  }

  // Torrent options
  async toggleSequentialDownload(hashes: string): Promise<void> {
    const params = new URLSearchParams();
    params.append('hashes', hashes);
    await this.post('/api/v2/torrents/toggleSequentialDownload', params.toString());
  }

  async toggleFirstLastPiecePrio(hashes: string): Promise<void> {
    const params = new URLSearchParams();
    params.append('hashes', hashes);
    await this.post('/api/v2/torrents/toggleFirstLastPiecePrio', params.toString());
  }

  async setCategory(hashes: string, category: string): Promise<void> {
    const params = new URLSearchParams();
    params.append('hashes', hashes);
    params.append('category', category);
    await this.post('/api/v2/torrents/setCategory', params.toString());
  }

  async setShareLimits(hashes: string, ratioLimit: number, seedingTimeLimit: number, inactiveSeedingTimeLimit: number): Promise<void> {
    const params = new URLSearchParams();
    params.append('hashes', hashes);
    params.append('ratioLimit', String(ratioLimit));
    params.append('seedingTimeLimit', String(seedingTimeLimit));
    params.append('inactiveSeedingTimeLimit', String(inactiveSeedingTimeLimit));
    await this.post('/api/v2/torrents/setShareLimits', params.toString());
  }

  async recheckTorrent(hashes: string): Promise<void> {
    const params = new URLSearchParams();
    params.append('hashes', hashes);
    await this.post('/api/v2/torrents/recheck', params.toString());
  }

  async reannounceTorrent(hashes: string): Promise<void> {
    const params = new URLSearchParams();
    params.append('hashes', hashes);
    await this.post('/api/v2/torrents/reannounce', params.toString());
  }

  async setAutoManagement(hashes: string, enable: boolean): Promise<void> {
    const params = new URLSearchParams();
    params.append('hashes', hashes);
    params.append('enable', String(enable));
    await this.post('/api/v2/torrents/setAutoManagement', params.toString());
  }

  async renameTorrent(hash: string, name: string): Promise<void> {
    const params = new URLSearchParams();
    params.append('hash', hash);
    params.append('name', name);
    await this.post('/api/v2/torrents/rename', params.toString());
  }

  /** Paths inside the torrent, as torrents/files names them; qBittorrent answers 409 when `newPath` is taken. */
  async renameFile(hash: string, oldPath: string, newPath: string): Promise<void> {
    const params = new URLSearchParams();
    params.append('hash', hash);
    params.append('oldPath', oldPath);
    params.append('newPath', newPath);
    await this.post('/api/v2/torrents/renameFile', params.toString());
  }

  /** As renameFile, for a folder and everything in it. */
  async renameFolder(hash: string, oldPath: string, newPath: string): Promise<void> {
    const params = new URLSearchParams();
    params.append('hash', hash);
    params.append('oldPath', oldPath);
    params.append('newPath', newPath);
    await this.post('/api/v2/torrents/renameFolder', params.toString());
  }

  /** Moves the torrents' files; qBittorrent also turns their automatic management off. */
  async setLocation(hashes: string, location: string): Promise<void> {
    const params = new URLSearchParams();
    params.append('hashes', hashes);
    params.append('location', location);
    await this.post('/api/v2/torrents/setLocation', params.toString());
  }

  /** One URL per line, all in tier 0 (a blank line would start the next tier); ones the torrent has are skipped. */
  async addTrackers(hash: string, urls: string[]): Promise<void> {
    const params = new URLSearchParams();
    params.append('hash', hash);
    params.append('urls', urls.join('\n'));
    await this.post('/api/v2/torrents/addTrackers', params.toString());
  }

  /** qBittorrent answers 409 when `origUrl` is not on the torrent or `newUrl` already is. */
  async editTracker(hash: string, origUrl: string, newUrl: string): Promise<void> {
    const params = new URLSearchParams();
    params.append('hash', hash);
    params.append('origUrl', origUrl);
    params.append('newUrl', newUrl);
    await this.post('/api/v2/torrents/editTracker', params.toString());
  }

  /** qBittorrent splits `urls` on `|` and skips any it does not have. */
  async removeTrackers(hash: string, urls: string[]): Promise<void> {
    const params = new URLSearchParams();
    params.append('hash', hash);
    params.append('urls', urls.join('|'));
    await this.post('/api/v2/torrents/removeTrackers', params.toString());
  }

  async getTags(): Promise<string[]> {
    return this.get<string[]>('/api/v2/torrents/tags');
  }

  /** qBittorrent creates a tag it does not know yet. */
  async addTags(hashes: string, tags: string[]): Promise<void> {
    const params = new URLSearchParams();
    params.append('hashes', hashes);
    params.append('tags', tags.join(','));
    await this.post('/api/v2/torrents/addTags', params.toString());
  }

  /** `tags` must not be empty: qBittorrent removes every tag when it is. */
  async removeTags(hashes: string, tags: string[]): Promise<void> {
    if (tags.length === 0) throw new Error('removeTags needs at least one tag');
    const params = new URLSearchParams();
    params.append('hashes', hashes);
    params.append('tags', tags.join(','));
    await this.post('/api/v2/torrents/removeTags', params.toString());
  }

  async isQueueingEnabled(): Promise<boolean> {
    const preferences = await this.get<{ queueing_enabled?: unknown }>('/api/v2/app/preferences');
    return preferences.queueing_enabled === true;
  }

  /** qBittorrent refuses these (409) while torrent queueing is off. */
  async moveInQueue(hashes: string, move: QueueMove): Promise<void> {
    const params = new URLSearchParams();
    params.append('hashes', hashes);
    await this.post(`/api/v2/torrents/${move}`, params.toString());
  }

  // Transfer
  /**
   * Copied out field by field (normalizeTransferInfo): qBittorrent also sends
   * its last external IPv4 and IPv6 address, the owner's public IP.
   */
  async getTransferInfo(): Promise<QBittorrentTransferInfo> {
    return normalizeTransferInfo(await this.get<QBittorrentTransferInfo>('/api/v2/transfer/info'));
  }

  /**
   * All-time totals and free disk space. Only sync/maindata has them, and only
   * in a full update (rid=0), which also lists every torrent: callers cache it.
   * Copied out field by field, so the torrent and tracker maps (magnets,
   * tracker URLs with passkeys) never leave this method.
   */
  async getServerStats(): Promise<QBittorrentServerStats> {
    const data = await this.get<{ server_state?: unknown }>('/api/v2/sync/maindata', { rid: 0 });
    const state = data?.server_state;
    if (!state || typeof state !== 'object') throw new NotServiceApiError();
    const { free_space_on_disk, alltime_dl, alltime_ul, global_ratio } = state as Record<string, unknown>;
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

  // Global speed limits. Read and written as preferences, not through
  // transfer/(set)DownloadLimit: those follow the active mode, so with
  // alternative speed mode on they read and overwrite the alternative limits.
  async getSpeedLimits(): Promise<SpeedLimits> {
    // app/preferences also carries the Web UI and proxy passwords: copy out the
    // four limits only.
    const preferences = await this.get<Record<string, unknown>>('/api/v2/app/preferences');
    const limits = {} as SpeedLimits;
    for (const key of SPEED_LIMIT_PREFERENCES) {
      const value = preferences[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new NotServiceApiError();
      }
      limits[key] = value;
    }
    return limits;
  }

  /** Bytes per second; 0 is unlimited. Keys outside the four limits are never sent. */
  async setSpeedLimits(limits: Partial<SpeedLimits>): Promise<void> {
    // setPreferences also changes the Web UI password and the program run on
    // completion, so the payload is rebuilt from the allow-list.
    const json: Partial<SpeedLimits> = {};
    for (const key of SPEED_LIMIT_PREFERENCES) {
      const value = limits[key];
      if (value !== undefined) json[key] = value;
    }
    if (Object.keys(json).length === 0) throw new Error('setSpeedLimits needs at least one limit');
    const params = new URLSearchParams();
    params.append('json', JSON.stringify(json));
    await this.post('/api/v2/app/setPreferences', params.toString());
  }

  async getSpeedLimitsMode(): Promise<number> {
    return this.get<number>('/api/v2/transfer/speedLimitsMode');
  }

  async toggleSpeedLimitsMode(): Promise<void> {
    await this.post('/api/v2/transfer/toggleSpeedLimitsMode');
  }

  // App
  async getVersion(): Promise<string> {
    return this.get<string>('/api/v2/app/version');
  }
}
