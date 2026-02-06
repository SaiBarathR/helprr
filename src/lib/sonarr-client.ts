import axios, { AxiosInstance } from 'axios';
import type {
  SonarrSeries,
  SonarrEpisode,
  SonarrCalendarEntry,
  QueueResponse,
  HistoryResponse,
  ManualImportItem,
  QualityProfile,
  RootFolder,
  DiskSpace,
  HealthCheck,
  SonarrLookupResult,
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

export class SonarrClient {
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

  // Series
  async getSeries(): Promise<SonarrSeries[]> {
    return this.get<SonarrSeries[]>('/api/v3/series');
  }

  async getSeriesById(id: number): Promise<SonarrSeries> {
    return this.get<SonarrSeries>(`/api/v3/series/${id}`);
  }

  async addSeries(body: Partial<SonarrSeries>): Promise<SonarrSeries> {
    return this.post<SonarrSeries>('/api/v3/series', body);
  }

  async updateSeries(body: SonarrSeries): Promise<SonarrSeries> {
    return this.put<SonarrSeries>(`/api/v3/series/${body.id}`, body);
  }

  async deleteSeries(id: number, deleteFiles: boolean = false): Promise<void> {
    await this.delete(`/api/v3/series/${id}`, { deleteFiles });
  }

  // Episodes
  async getEpisodes(seriesId: number): Promise<SonarrEpisode[]> {
    return this.get<SonarrEpisode[]>('/api/v3/episode', { seriesId });
  }

  async getEpisodeById(id: number): Promise<SonarrEpisode> {
    return this.get<SonarrEpisode>(`/api/v3/episode/${id}`);
  }

  async setEpisodeMonitored(id: number, monitored: boolean): Promise<SonarrEpisode[]> {
    return this.put<SonarrEpisode[]>('/api/v3/episode/monitor', {
      episodeIds: [id],
      monitored,
    });
  }

  // Commands
  async searchEpisode(episodeIds: number[]): Promise<CommandResponse> {
    return this.post<CommandResponse>('/api/v3/command', {
      name: 'EpisodeSearch',
      episodeIds,
    });
  }

  async searchSeason(seriesId: number, seasonNumber: number): Promise<CommandResponse> {
    return this.post<CommandResponse>('/api/v3/command', {
      name: 'SeasonSearch',
      seriesId,
      seasonNumber,
    });
  }

  async refreshSeries(seriesId: number): Promise<CommandResponse> {
    return this.post<CommandResponse>('/api/v3/command', {
      name: 'RefreshSeries',
      seriesId,
    });
  }

  // Calendar
  async getCalendar(start: string, end: string): Promise<SonarrCalendarEntry[]> {
    return this.get<SonarrCalendarEntry[]>('/api/v3/calendar', {
      start,
      end,
      includeSeries: true,
    });
  }

  // Queue
  async getQueue(page: number = 1, pageSize: number = 20): Promise<QueueResponse> {
    return this.get<QueueResponse>('/api/v3/queue', {
      page,
      pageSize,
      includeEpisode: true,
      includeSeries: true,
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
      includeSeries: true,
      includeEpisode: true,
    });
  }

  // Manual Import
  async getManualImport(downloadId: string, seriesId?: number): Promise<ManualImportItem[]> {
    const params: Record<string, unknown> = { downloadId };
    if (seriesId !== undefined) {
      params.seriesId = seriesId;
    }
    return this.get<ManualImportItem[]>('/api/v3/manualimport', params);
  }

  async submitManualImport(body: ManualImportItem[]): Promise<CommandResponse> {
    return this.post<CommandResponse>('/api/v3/command', {
      name: 'ManualImport',
      files: body,
    });
  }

  // Lookup
  async lookupSeries(term: string): Promise<SonarrLookupResult[]> {
    return this.get<SonarrLookupResult[]>('/api/v3/series/lookup', { term });
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
