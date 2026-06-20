import axios, { AxiosInstance } from 'axios';
import { keepAliveHttpAgent, keepAliveHttpsAgent } from '@/lib/http-agents';
import type {
  LidarrArtist,
  LidarrAlbum,
  LidarrTrack,
  LidarrTrackFile,
  LidarrCalendarEntry,
  LidarrRenamePreview,
  LidarrArtistLookupResult,
  LidarrAlbumLookupResult,
  LidarrMetadataProfile,
  QueueResponse,
  HistoryResponse,
  HistoryItem,
  QualityProfile,
  RootFolder,
  DiskSpace,
  HealthCheck,
  Release,
  DownloadClient,
} from '@/types';

interface SystemStatus {
  version: string;
  buildTime: string;
  appName: string;
  instanceName: string;
  isProduction: boolean;
  branch: string;
  authentication: string;
  urlBase: string;
  runtimeVersion: string;
  runtimeName: string;
}

interface Tag {
  id: number;
  label: string;
}

interface CommandResponse {
  id: number;
  name: string;
  commandName: string;
  status: string;
  queued: string;
  started?: string;
  ended?: string;
}

interface DeleteQueueOptions {
  removeFromClient?: boolean;
  blocklist?: boolean;
  changeCategory?: boolean;
  skipRedownload?: boolean;
}

interface WantedResponse {
  page: number;
  pageSize: number;
  totalRecords: number;
  records: LidarrAlbum[];
}

/**
 * Lidarr API client. Mirrors the Sonarr/Radarr clients, but Lidarr exposes its
 * REST surface under `/api/v1` (not `/api/v3`). Hierarchy: Artist → Album
 * (→ Release) → Track + TrackFile.
 */
export class LidarrClient {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(url: string, apiKey: string) {
    this.baseUrl = url.replace(/\/+$/, '');
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
      httpAgent: keepAliveHttpAgent,
      httpsAgent: keepAliveHttpsAgent,
    });
  }

  // Lidarr's image fields are inconsistent: for some artists `url` is a full
  // TheAudioDB/CoverArtArchive CDN URL with no `remoteUrl`, while for others
  // `remoteUrl` is a useless local filesystem path (/var/lib/lidarr/...) and `url`
  // is a relative `/MediaCover/...` path. Resolve each image to a single usable
  // `remoteUrl`: prefer an http URL from either field, else make the local
  // `/MediaCover` path absolute so /api/image can proxy it with the API key.
  private resolveImage(img: { url?: string; remoteUrl?: string; coverType?: string; extension?: string }) {
    const candidates = [img.url, img.remoteUrl];
    const httpUrl = candidates.find((u) => typeof u === 'string' && /^https?:\/\//i.test(u));
    let best = httpUrl;
    if (!best) {
      const mediaCover = candidates.find((u) => typeof u === 'string' && u.startsWith('/MediaCover'));
      if (mediaCover) best = `${this.baseUrl}${mediaCover}`;
    }
    return { ...img, remoteUrl: best ?? '' };
  }

  // Recursively rewrite every `images` array in a response so embedded artists
  // (queue/history/calendar/album) get fixed image URLs too.
  private fixImages<T>(data: T): T {
    const seen = new Set<unknown>();
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object' || seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      const obj = node as Record<string, unknown>;
      if (Array.isArray(obj.images)) {
        obj.images = obj.images.map((img) =>
          img && typeof img === 'object' ? this.resolveImage(img as { url?: string; remoteUrl?: string }) : img
        );
      }
      for (const key of Object.keys(obj)) {
        if (key === 'images') continue;
        walk(obj[key]);
      }
    };
    walk(data);
    return data;
  }

  private async get<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    const response = await this.client.get<T>(endpoint, { params });
    return this.fixImages(response.data);
  }

  private async post<T>(endpoint: string, body?: unknown): Promise<T> {
    const response = await this.client.post<T>(endpoint, body);
    return this.fixImages(response.data);
  }

  private async put<T>(endpoint: string, body?: unknown): Promise<T> {
    const response = await this.client.put<T>(endpoint, body);
    return this.fixImages(response.data);
  }

  private async delete<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    const response = await this.client.delete<T>(endpoint, { params });
    return response.data;
  }

  // Artists
  async getArtists(): Promise<LidarrArtist[]> {
    return this.get<LidarrArtist[]>('/api/v1/artist');
  }

  async getArtistById(id: number): Promise<LidarrArtist> {
    return this.get<LidarrArtist>(`/api/v1/artist/${id}`);
  }

  async addArtist(body: Partial<LidarrArtist>): Promise<LidarrArtist> {
    return this.post<LidarrArtist>('/api/v1/artist', body);
  }

  async updateArtist(body: LidarrArtist, moveFiles: boolean = false): Promise<LidarrArtist> {
    const endpoint = `/api/v1/artist/${body.id}${moveFiles ? '?moveFiles=true' : ''}`;
    return this.put<LidarrArtist>(endpoint, body);
  }

  async deleteArtist(
    id: number,
    deleteFiles: boolean = false,
    addImportListExclusion: boolean = false
  ): Promise<void> {
    await this.delete(`/api/v1/artist/${id}`, { deleteFiles, addImportListExclusion });
  }

  // Bulk editor — one request for monitored/tags across many artists.
  async artistEditor(body: {
    artistIds: number[];
    monitored?: boolean;
    tags?: number[];
    applyTags?: 'add' | 'remove' | 'replace';
  }): Promise<LidarrArtist[]> {
    return this.put<LidarrArtist[]>('/api/v1/artist/editor', body);
  }

  // DELETE /editor carries its options in the request body, not the query string.
  async deleteArtistsBulk(artistIds: number[], deleteFiles: boolean = false): Promise<void> {
    await this.client.delete('/api/v1/artist/editor', {
      data: { artistIds, deleteFiles, addImportListExclusion: false },
    });
  }

  // Albums
  async getAlbums(artistId: number): Promise<LidarrAlbum[]> {
    return this.get<LidarrAlbum[]>('/api/v1/album', { artistId, includeAllArtistAlbums: true });
  }

  async getAlbumById(id: number): Promise<LidarrAlbum> {
    return this.get<LidarrAlbum>(`/api/v1/album/${id}`);
  }

  async updateAlbum(body: LidarrAlbum): Promise<LidarrAlbum> {
    return this.put<LidarrAlbum>(`/api/v1/album/${body.id}`, body);
  }

  /** Monitor/unmonitor a set of albums in bulk. */
  async setAlbumsMonitored(albumIds: number[], monitored: boolean): Promise<void> {
    await this.put('/api/v1/album/monitor', { albumIds, monitored });
  }

  // Tracks & files
  async getTracks(albumId: number): Promise<LidarrTrack[]> {
    return this.get<LidarrTrack[]>('/api/v1/track', { albumId });
  }

  async getTrackFiles(params: { artistId?: number; albumId?: number }): Promise<LidarrTrackFile[]> {
    return this.get<LidarrTrackFile[]>('/api/v1/trackfile', params);
  }

  async deleteTrackFile(id: number): Promise<void> {
    await this.delete(`/api/v1/trackfile/${id}`);
  }

  // Lookup (search to add)
  async lookupArtist(term: string): Promise<LidarrArtistLookupResult[]> {
    return this.get<LidarrArtistLookupResult[]>('/api/v1/artist/lookup', { term });
  }

  async lookupAlbum(term: string): Promise<LidarrAlbumLookupResult[]> {
    return this.get<LidarrAlbumLookupResult[]>('/api/v1/album/lookup', { term });
  }

  // Release (Interactive Search)
  async getReleases(params: { artistId?: number; albumId?: number }): Promise<Release[]> {
    return this.get<Release[]>('/api/v1/release', params);
  }

  async grabRelease(guid: string, indexerId: number, downloadClientId?: number): Promise<void> {
    const body: Record<string, unknown> = { guid, indexerId };
    if (downloadClientId !== undefined) body.downloadClientId = downloadClientId;
    await this.post('/api/v1/release', body);
  }

  async getDownloadClients(): Promise<DownloadClient[]> {
    return this.get<DownloadClient[]>('/api/v1/downloadclient');
  }

  // Wanted
  async getWantedMissing(page = 1, pageSize = 20): Promise<WantedResponse> {
    return this.get('/api/v1/wanted/missing', {
      page,
      pageSize,
      sortKey: 'releaseDate',
      sortDirection: 'descending',
      includeArtist: true,
    });
  }

  async getCutoffUnmet(page = 1, pageSize = 20): Promise<WantedResponse> {
    return this.get('/api/v1/wanted/cutoff', {
      page,
      pageSize,
      sortKey: 'releaseDate',
      sortDirection: 'descending',
      includeArtist: true,
    });
  }

  // Calendar — albums releasing in the window
  async getCalendar(start: string, end: string): Promise<LidarrCalendarEntry[]> {
    return this.get<LidarrCalendarEntry[]>('/api/v1/calendar', {
      start,
      end,
      includeArtist: true,
    });
  }

  // Queue
  async getQueue(page: number = 1, pageSize: number = 20): Promise<QueueResponse> {
    return this.get<QueueResponse>('/api/v1/queue', {
      page,
      pageSize,
      includeArtist: true,
      includeAlbum: true,
    });
  }

  async deleteQueueItem(id: number, options: DeleteQueueOptions = {}): Promise<void> {
    const params: Record<string, unknown> = {
      removeFromClient: options.removeFromClient ?? false,
      blocklist: options.blocklist ?? false,
    };
    if (options.changeCategory) params.changeCategory = true;
    if (options.skipRedownload) params.skipRedownload = true;
    await this.delete(`/api/v1/queue/${id}`, params);
  }

  // History
  async getHistory(
    page: number = 1,
    pageSize: number = 20,
    sortKey: string = 'date',
    sortDirection: string = 'descending',
    filters?: { artistId?: number; albumId?: number; eventType?: number; downloadId?: string }
  ): Promise<HistoryResponse> {
    const params: Record<string, unknown> = {
      page,
      pageSize,
      sortKey,
      sortDirection,
      includeArtist: true,
      includeAlbum: true,
    };
    if (filters?.artistId) params.artistId = filters.artistId;
    if (filters?.albumId) params.albumId = filters.albumId;
    if (filters?.eventType !== undefined) params.eventType = filters.eventType;
    if (filters?.downloadId) params.downloadId = filters.downloadId;
    return this.get<HistoryResponse>('/api/v1/history', params);
  }

  async getArtistHistory(artistId: number, albumId?: number): Promise<HistoryItem[]> {
    const params: Record<string, unknown> = { artistId, includeArtist: true, includeAlbum: true };
    if (albumId !== undefined) params.albumId = albumId;
    return this.get<HistoryItem[]>('/api/v1/history/artist', params);
  }

  // Commands
  async searchArtist(artistId: number): Promise<CommandResponse> {
    return this.post<CommandResponse>('/api/v1/command', { name: 'ArtistSearch', artistId });
  }

  async searchAlbums(albumIds: number[]): Promise<CommandResponse> {
    return this.post<CommandResponse>('/api/v1/command', { name: 'AlbumSearch', albumIds });
  }

  async refreshArtist(artistId: number): Promise<CommandResponse> {
    return this.post<CommandResponse>('/api/v1/command', { name: 'RefreshArtist', artistId });
  }

  async refreshMonitoredDownloads(): Promise<CommandResponse> {
    return this.post<CommandResponse>('/api/v1/command', { name: 'RefreshMonitoredDownloads' });
  }

  async getCommand(id: number): Promise<CommandResponse> {
    return this.get<CommandResponse>(`/api/v1/command/${id}`);
  }

  async renameArtistFiles(artistId: number, files?: number[]): Promise<CommandResponse> {
    if (files && files.length === 0) {
      return Promise.reject(new Error('renameArtistFiles requires at least one file id'));
    }
    const body: Record<string, unknown> = { name: 'RenameFiles', artistId };
    if (files && files.length > 0) body.files = files;
    return this.post<CommandResponse>('/api/v1/command', body);
  }

  async getRenamePreview(artistId: number, albumId?: number): Promise<LidarrRenamePreview[]> {
    const params: Record<string, unknown> = { artistId };
    if (albumId !== undefined) params.albumId = albumId;
    return this.get<LidarrRenamePreview[]>('/api/v1/rename', params);
  }

  // Configuration
  async getQualityProfiles(): Promise<QualityProfile[]> {
    return this.get<QualityProfile[]>('/api/v1/qualityprofile');
  }

  async getMetadataProfiles(): Promise<LidarrMetadataProfile[]> {
    return this.get<LidarrMetadataProfile[]>('/api/v1/metadataprofile');
  }

  async getRootFolders(): Promise<RootFolder[]> {
    return this.get<RootFolder[]>('/api/v1/rootfolder');
  }

  async getTags(): Promise<Tag[]> {
    return this.get<Tag[]>('/api/v1/tag');
  }

  async createTag(label: string): Promise<Tag> {
    return this.post<Tag>('/api/v1/tag', { label });
  }

  // System
  async getDiskSpace(): Promise<DiskSpace[]> {
    return this.get<DiskSpace[]>('/api/v1/diskspace');
  }

  async getHealth(): Promise<HealthCheck[]> {
    return this.get<HealthCheck[]>('/api/v1/health');
  }

  async getSystemStatus(): Promise<SystemStatus> {
    return this.get<SystemStatus>('/api/v1/system/status');
  }
}
