import axios, { AxiosInstance } from 'axios';
import { keepAliveHttpAgent, keepAliveHttpsAgent } from '@/lib/http-agents';
import type {
  RadarrMovie,
  RadarrCollection,
  RadarrCalendarEntry,
  RadarrCredit,
  RadarrRenamePreview,
  QueueResponse,
  HistoryItem,
  HistoryResponse,
  ManualImportItem,
  MovieFileResource,
  QualityProfile,
  QualityDefinition,
  ArrLanguage,
  RootFolder,
  MediaManagementConfig,
  DiskSpace,
  HealthCheck,
  RadarrLookupResult,
  Release,
  DownloadClient,
} from '@/types';

interface SystemStatus {
  version: string;
  buildTime: string;
  isDebug: boolean;
  isProduction: boolean;
  isAdmin: boolean;
  isUserInteractive: boolean;
  startupPath: string;
  appData: string;
  osName: string;
  osVersion: string;
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

export class RadarrClient {
  private client: AxiosInstance;

  constructor(url: string, apiKey: string) {
    this.client = axios.create({
      baseURL: url.replace(/\/+$/, ''),
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
      httpAgent: keepAliveHttpAgent,
      httpsAgent: keepAliveHttpsAgent,
    });
  }

  private async get<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    const response = await this.client.get<T>(endpoint, { params });
    return response.data;
  }

  private async post<T>(endpoint: string, body?: unknown): Promise<T> {
    const response = await this.client.post<T>(endpoint, body);
    return response.data;
  }

  private async put<T>(endpoint: string, body?: unknown): Promise<T> {
    const response = await this.client.put<T>(endpoint, body);
    return response.data;
  }

  private async delete<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    const response = await this.client.delete<T>(endpoint, { params });
    return response.data;
  }

  // Movies
  async getMovies(): Promise<RadarrMovie[]> {
    return this.get<RadarrMovie[]>('/api/v3/movie');
  }

  async getMovieById(id: number): Promise<RadarrMovie> {
    return this.get<RadarrMovie>(`/api/v3/movie/${id}`);
  }

  async addMovie(body: Partial<RadarrMovie>): Promise<RadarrMovie> {
    return this.post<RadarrMovie>('/api/v3/movie', body);
  }

  async updateMovie(body: RadarrMovie, moveFiles: boolean = false): Promise<RadarrMovie> {
    const endpoint = `/api/v3/movie/${body.id}${moveFiles ? '?moveFiles=true' : ''}`;
    return this.put<RadarrMovie>(endpoint, body);
  }

  async deleteMovie(
    id: number,
    deleteFiles: boolean = false,
    addImportExclusion: boolean = false
  ): Promise<void> {
    await this.delete(`/api/v3/movie/${id}`, { deleteFiles, addImportExclusion });
  }

  // Bulk editor — one request for monitored/tags across many movies.
  async movieEditor(body: {
    movieIds: number[];
    monitored?: boolean;
    tags?: number[];
    applyTags?: 'add' | 'remove' | 'replace';
  }): Promise<RadarrMovie[]> {
    return this.put<RadarrMovie[]>('/api/v3/movie/editor', body);
  }

  // DELETE /editor carries its options in the request body, not the query string.
  async deleteMoviesBulk(movieIds: number[], deleteFiles: boolean = false): Promise<void> {
    await this.client.delete('/api/v3/movie/editor', {
      data: { movieIds, deleteFiles, addImportExclusion: false },
    });
  }

  // Credits
  async getCredits(movieId: number): Promise<RadarrCredit[]> {
    return this.get<RadarrCredit[]>('/api/v3/credit', { movieId });
  }

  // Release (Interactive Search)
  async getReleases(movieId: number): Promise<Release[]> {
    return this.get<Release[]>('/api/v3/release', { movieId });
  }

  async grabRelease(guid: string, indexerId: number, downloadClientId?: number): Promise<void> {
    const body: Record<string, unknown> = { guid, indexerId };
    if (downloadClientId !== undefined) body.downloadClientId = downloadClientId;
    await this.post('/api/v3/release', body);
  }

  async getDownloadClients(): Promise<DownloadClient[]> {
    return this.get<DownloadClient[]>('/api/v3/downloadclient');
  }

  // Wanted
  async getWantedMissing(page = 1, pageSize = 20): Promise<{ page: number; pageSize: number; totalRecords: number; records: RadarrMovie[] }> {
    return this.get('/api/v3/wanted/missing', { page, pageSize, sortKey: 'date', sortDirection: 'descending' });
  }

  async getCutoffUnmet(page = 1, pageSize = 20): Promise<{ page: number; pageSize: number; totalRecords: number; records: RadarrMovie[] }> {
    return this.get('/api/v3/wanted/cutoff', { page, pageSize, sortKey: 'date', sortDirection: 'descending' });
  }

  // Calendar
  async getCalendar(start: string, end: string): Promise<RadarrCalendarEntry[]> {
    return this.get<RadarrCalendarEntry[]>('/api/v3/calendar', { start, end });
  }

  // Collections
  async getCollections(): Promise<RadarrCollection[]> {
    return this.get<RadarrCollection[]>('/api/v3/collection');
  }

  // Queue
  async getQueue(page: number = 1, pageSize: number = 20): Promise<QueueResponse> {
    return this.get<QueueResponse>('/api/v3/queue', {
      page,
      pageSize,
      includeMovie: true,
    });
  }

  async deleteQueueItem(id: number, options: DeleteQueueOptions = {}): Promise<void> {
    const params: Record<string, unknown> = {
      removeFromClient: options.removeFromClient ?? false,
      blocklist: options.blocklist ?? false,
    };
    if (options.changeCategory) params.changeCategory = true;
    if (options.skipRedownload) params.skipRedownload = true;
    await this.delete(`/api/v3/queue/${id}`, params);
  }

  // History
  async getHistory(
    page: number = 1,
    pageSize: number = 20,
    sortKey: string = 'date',
    sortDirection: string = 'descending',
    filters?: { movieId?: number; eventType?: number; downloadId?: string }
  ): Promise<HistoryResponse> {
    const params: Record<string, unknown> = {
      page,
      pageSize,
      sortKey,
      sortDirection,
      includeMovie: true,
    };
    if (filters?.movieId) params.movieId = filters.movieId;
    if (filters?.eventType !== undefined) params.eventType = filters.eventType;
    if (filters?.downloadId) params.downloadId = filters.downloadId;
    return this.get<HistoryResponse>('/api/v3/history', params);
  }

  async getMovieHistory(movieId: number): Promise<HistoryItem[]> {
    return this.get<HistoryItem[]>('/api/v3/history/movie', { movieId });
  }

  // Movie files — Manage Files
  async getMovieFiles(movieId: number): Promise<MovieFileResource[]> {
    return this.get<MovieFileResource[]>('/api/v3/moviefile', { movieId });
  }

  // Bulk metadata edit. Array of resources keyed by id; the server applies only
  // the non-null fields. Uses /bulk (the /editor endpoint is deprecated upstream).
  async bulkEditMovieFiles(
    resources: Partial<MovieFileResource>[]
  ): Promise<MovieFileResource[]> {
    return this.put<MovieFileResource[]>('/api/v3/moviefile/bulk', resources);
  }

  // DELETE /moviefile/bulk carries the ids in the request body.
  async deleteMovieFilesBulk(movieFileIds: number[]): Promise<void> {
    await this.client.delete('/api/v3/moviefile/bulk', {
      data: { movieFileIds },
    });
  }

  // Folder scan for Manage Files. movieId WITHOUT a folder hits Radarr's
  // dedicated "manage files" branch: imported MovieFiles + loose unmapped files
  // in the movie folder, with no decision-engine rejections on the imported ones.
  async scanManualImport(params: {
    movieId: number;
    folder?: string;
    filterExistingFiles?: boolean;
  }): Promise<ManualImportItem[]> {
    const query: Record<string, unknown> = { movieId: params.movieId };
    if (params.folder) {
      query.folder = params.folder;
      query.filterExistingFiles = params.filterExistingFiles ?? false;
    }
    return this.get<ManualImportItem[]>('/api/v3/manualimport', query);
  }

  // Re-run the import decision engine after a row edit (rejections + CF score).
  // No disk changes.
  async reprocessManualImport(items: unknown[]): Promise<ManualImportItem[]> {
    return this.post<ManualImportItem[]>('/api/v3/manualimport', items);
  }

  // Manual Import
  async getManualImport(downloadId: string): Promise<ManualImportItem[]> {
    return this.get<ManualImportItem[]>('/api/v3/manualimport', { downloadId });
  }

  async submitManualImport(
    body: unknown[],
    importMode?: 'auto' | 'move' | 'copy'
  ): Promise<CommandResponse> {
    const payload: Record<string, unknown> = { name: 'ManualImport', files: body };
    if (importMode) payload.importMode = importMode;
    return this.post<CommandResponse>('/api/v3/command', payload);
  }

  // Lookup
  async lookupMovie(term: string): Promise<RadarrLookupResult[]> {
    return this.get<RadarrLookupResult[]>('/api/v3/movie/lookup', { term });
  }

  // Commands
  async searchMovie(movieIds: number[]): Promise<CommandResponse> {
    return this.post<CommandResponse>('/api/v3/command', {
      name: 'MoviesSearch',
      movieIds,
    });
  }

  async refreshMovie(movieId: number): Promise<CommandResponse> {
    return this.post<CommandResponse>('/api/v3/command', {
      name: 'RefreshMovie',
      movieIds: [movieId],
    });
  }

  async getCommand(id: number): Promise<CommandResponse> {
    return this.get<CommandResponse>(`/api/v3/command/${id}`);
  }

  async refreshMonitoredDownloads(): Promise<CommandResponse> {
    return this.post<CommandResponse>('/api/v3/command', {
      name: 'RefreshMonitoredDownloads',
    });
  }

  async renameMovie(movieId: number): Promise<CommandResponse> {
    return this.post<CommandResponse>('/api/v3/command', {
      name: 'RenameFiles',
      movieId,
    });
  }

  async renameMovieFiles(movieId: number, files: number[]): Promise<CommandResponse> {
    return this.post<CommandResponse>('/api/v3/command', {
      name: 'RenameFiles',
      movieId,
      files,
    });
  }

  async getRenamePreview(movieId: number): Promise<RadarrRenamePreview[]> {
    return this.get<RadarrRenamePreview[]>('/api/v3/rename', { movieId });
  }

  // Configuration
  async getQualityProfiles(): Promise<QualityProfile[]> {
    return this.get<QualityProfile[]>('/api/v3/qualityprofile');
  }

  async getRootFolders(): Promise<RootFolder[]> {
    return this.get<RootFolder[]>('/api/v3/rootfolder');
  }

  async getMediaManagementConfig(): Promise<MediaManagementConfig> {
    return this.get<MediaManagementConfig>('/api/v3/config/mediamanagement');
  }

  async getQualityDefinitions(): Promise<QualityDefinition[]> {
    return this.get<QualityDefinition[]>('/api/v3/qualitydefinition');
  }

  async getLanguages(): Promise<ArrLanguage[]> {
    return this.get<ArrLanguage[]>('/api/v3/language');
  }

  async getTags(): Promise<Tag[]> {
    return this.get<Tag[]>('/api/v3/tag');
  }

  async createTag(label: string): Promise<Tag> {
    return this.post<Tag>('/api/v3/tag', { label });
  }

  // System
  async getDiskSpace(): Promise<DiskSpace[]> {
    return this.get<DiskSpace[]>('/api/v3/diskspace');
  }

  async getHealth(): Promise<HealthCheck[]> {
    return this.get<HealthCheck[]>('/api/v3/health');
  }

  async getSystemStatus(): Promise<SystemStatus> {
    return this.get<SystemStatus>('/api/v3/system/status');
  }
}
