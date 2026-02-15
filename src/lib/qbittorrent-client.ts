import axios, { AxiosInstance } from 'axios';
import type { QBittorrentTorrent, QBittorrentTransferInfo } from '@/types';

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

  constructor(url: string, password: string, username: string = 'admin') {
    this.baseUrl = url.replace(/\/+$/, '');
    this.username = username;
    this.password = password;

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
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
      throw new Error('qBittorrent authentication failed: no SID cookie received');
    }
  }

  private async get<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    await this.ensureAuthenticated();
    try {
      const response = await this.client.get<T>(endpoint, {
        params,
        headers: { Cookie: this.cookie! },
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        this.cookie = null;
        await this.ensureAuthenticated();
        const response = await this.client.get<T>(endpoint, {
          params,
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
    reverse?: boolean
  ): Promise<QBittorrentTorrent[]> {
    const params: Record<string, unknown> = {};
    if (filter !== undefined) params.filter = filter;
    if (category !== undefined) params.category = category;
    if (sort !== undefined) params.sort = sort;
    if (reverse !== undefined) params.reverse = reverse;
    return this.get<QBittorrentTorrent[]>('/api/v2/torrents/info', params);
  }

  async getTorrentProperties(hash: string): Promise<TorrentProperties> {
    return this.get<TorrentProperties>('/api/v2/torrents/properties', { hash });
  }

  async getTorrentFiles(hash: string): Promise<TorrentFile[]> {
    return this.get<TorrentFile[]>('/api/v2/torrents/files', { hash });
  }

  async getTorrentTrackers(hash: string): Promise<TorrentTracker[]> {
    return this.get<TorrentTracker[]>('/api/v2/torrents/trackers', { hash });
  }

  async pauseTorrent(hashes: string): Promise<void> {
    const params = new URLSearchParams();
    params.append('hashes', hashes);
    await this.post('/api/v2/torrents/pause', params.toString());
  }

  async resumeTorrent(hashes: string): Promise<void> {
    const params = new URLSearchParams();
    params.append('hashes', hashes);
    await this.post('/api/v2/torrents/resume', params.toString());
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

  async addMagnet(urls: string, options?: { category?: string; savepath?: string; paused?: boolean }): Promise<void> {
    const params = new URLSearchParams();
    params.append('urls', urls);
    if (options?.category) params.append('category', options.category);
    if (options?.savepath) params.append('savepath', options.savepath);
    if (options?.paused !== undefined) params.append('paused', String(options.paused));
    await this.post('/api/v2/torrents/add', params.toString());
  }

  async addTorrentFile(fileBuffer: Uint8Array, filename: string, options?: { category?: string; savepath?: string; paused?: boolean }): Promise<void> {
    const formData = new FormData();
    const blob = new Blob([fileBuffer.buffer as ArrayBuffer], { type: 'application/x-bittorrent' });
    formData.append('torrents', blob, filename);
    if (options?.category) formData.append('category', options.category);
    if (options?.savepath) formData.append('savepath', options.savepath);
    if (options?.paused !== undefined) formData.append('paused', String(options.paused));
    await this.postMultipart('/api/v2/torrents/add', formData);
  }

  async getCategories(): Promise<Record<string, { name: string; savePath: string }>> {
    return this.get('/api/v2/torrents/categories');
  }

  // Transfer
  async getTransferInfo(): Promise<QBittorrentTransferInfo> {
    return this.get<QBittorrentTransferInfo>('/api/v2/transfer/info');
  }

  // App
  async getVersion(): Promise<string> {
    return this.get<string>('/api/v2/app/version');
  }
}
