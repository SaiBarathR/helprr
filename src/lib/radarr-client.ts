import axios, { AxiosInstance } from 'axios';
import type {
  RadarrMovie,
  RadarrCalendarEntry,
  QueueResponse,
  HistoryResponse,
  ManualImportItem,
  QualityProfile,
  RootFolder,
  DiskSpace,
  HealthCheck,
  RadarrLookupResult,
  Release,
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

  async updateMovie(body: RadarrMovie): Promise<RadarrMovie> {
    return this.put<RadarrMovie>(`/api/v3/movie/${body.id}`, body);
  }

  async deleteMovie(
    id: number,
    deleteFiles: boolean = false,
    addImportExclusion: boolean = false
  ): Promise<void> {
    await this.delete(`/api/v3/movie/${id}`, { deleteFiles, addImportExclusion });
  }

  // Release (Interactive Search)
  async getReleases(movieId: number): Promise<Release[]> {
    return this.get<Release[]>('/api/v3/release', { movieId });
  }

  async grabRelease(guid: string, indexerId: number): Promise<void> {
    await this.post('/api/v3/release', { guid, indexerId });
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

  // Queue
  async getQueue(page: number = 1, pageSize: number = 20): Promise<QueueResponse> {
    return this.get<QueueResponse>('/api/v3/queue', {
      page,
      pageSize,
      includeMovie: true,
    });
  }

  async deleteQueueItem(id: number, options: DeleteQueueOptions = {}): Promise<void> {
    await this.delete(`/api/v3/queue/${id}`, {
      removeFromClient: options.removeFromClient ?? false,
      blocklist: options.blocklist ?? false,
    });
  }

  // History
  async getHistory(
    page: number = 1,
    pageSize: number = 20,
    sortKey: string = 'date',
    sortDirection: string = 'descending'
  ): Promise<HistoryResponse> {
    return this.get<HistoryResponse>('/api/v3/history', {
      page,
      pageSize,
      sortKey,
      sortDirection,
      includeMovie: true,
    });
  }

  // Manual Import
  async getManualImport(downloadId: string): Promise<ManualImportItem[]> {
    return this.get<ManualImportItem[]>('/api/v3/manualimport', { downloadId });
  }

  async submitManualImport(body: ManualImportItem[]): Promise<CommandResponse> {
    return this.post<CommandResponse>('/api/v3/command', {
      name: 'ManualImport',
      files: body,
    });
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
      movieId,
    });
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

  // Configuration
  async getQualityProfiles(): Promise<QualityProfile[]> {
    return this.get<QualityProfile[]>('/api/v3/qualityprofile');
  }

  async getRootFolders(): Promise<RootFolder[]> {
    return this.get<RootFolder[]>('/api/v3/rootfolder');
  }

  async getTags(): Promise<Tag[]> {
    return this.get<Tag[]>('/api/v3/tag');
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
