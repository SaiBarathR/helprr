import axios, { AxiosInstance } from 'axios';

interface SystemStatus {
  version: string;
  buildTime: string;
  isDebug: boolean;
  isProduction: boolean;
  branch: string;
  appData: string;
  osName: string;
  osVersion: string;
  runtimeVersion: string;
  runtimeName: string;
}

export interface ProwlarrIndexer {
  id: number;
  name: string;
  enable: boolean;
  protocol: string;
  privacy: string;
  priority: number;
  tags: number[];
  fields: ProwlarrField[];
  implementationName: string;
  implementation: string;
  configContract: string;
  infoLink: string;
  supportsRss: boolean;
  supportsSearch: boolean;
  language?: string;
  description?: string;
  categories?: { id: number; name: string; subCategories?: { id: number; name: string }[] }[];
  appProfileId?: number;
}

export interface ProwlarrAppProfile {
  id: number;
  name: string;
}

export interface ProwlarrField {
  order: number;
  name: string;
  label: string;
  value?: unknown;
  type: string;
  advanced: boolean;
  selectOptions?: { value: number; name: string }[];
}

export interface ProwlarrIndexerStatus {
  providerId?: number;
  indexerId?: number;
  initialFailure?: string;
  mostRecentFailure?: string;
  escalationLevel?: number;
  disabledTill?: string;
}

export function getProwlarrIndexerStatusId(status: ProwlarrIndexerStatus): number | null {
  if (typeof status.indexerId === 'number') return status.indexerId;
  if (typeof status.providerId === 'number') return status.providerId;
  return null;
}

export function isProwlarrIndexerBlocked(status: ProwlarrIndexerStatus, now = Date.now()): boolean {
  if (!status.disabledTill) return false;
  const disabledTill = Date.parse(status.disabledTill);
  if (Number.isNaN(disabledTill)) return true;
  return disabledTill > now;
}

export interface ProwlarrValidationFailure {
  propertyName: string;
  errorMessage: string;
  severity: string;
}

export interface ProwlarrIndexerTestResult {
  id: number;
  isValid: boolean;
  validationFailures: ProwlarrValidationFailure[];
}

export interface ProwlarrTestAllResponse {
  results: ProwlarrIndexerTestResult[];
  passed: number;
  failed: number;
  hasFailures: boolean;
}

function isProwlarrIndexerTestResult(value: unknown): value is ProwlarrIndexerTestResult {
  if (!value || typeof value !== 'object') return false;

  const record = value as Record<string, unknown>;
  return typeof record.id === 'number'
    && typeof record.isValid === 'boolean'
    && Array.isArray(record.validationFailures);
}

function normalizeProwlarrTestAllResponse(results: ProwlarrIndexerTestResult[]): ProwlarrTestAllResponse {
  const failed = results.filter((result) => !result.isValid).length;
  return {
    results,
    passed: results.length - failed,
    failed,
    hasFailures: failed > 0,
  };
}

export function isProwlarrTestAllResponse(value: unknown): value is ProwlarrTestAllResponse {
  if (!value || typeof value !== 'object') return false;

  const record = value as Record<string, unknown>;
  return Array.isArray(record.results)
    && record.results.every(isProwlarrIndexerTestResult)
    && typeof record.passed === 'number'
    && typeof record.failed === 'number'
    && typeof record.hasFailures === 'boolean';
}

export interface ProwlarrIndexerStat {
  indexerId: number;
  indexerName: string;
  averageResponseTime: number;
  numberOfQueries: number;
  numberOfGrabs: number;
  numberOfRssQueries: number;
  numberOfAuthQueries: number;
  numberOfFailedQueries: number;
  numberOfFailedGrabs: number;
  numberOfFailedRssQueries: number;
  numberOfFailedAuthQueries: number;
}

export interface ProwlarrUserAgentStat {
  userAgent: string;
  numberOfQueries: number;
  numberOfGrabs: number;
}

export interface ProwlarrHostStat {
  host: string;
  numberOfQueries: number;
  numberOfGrabs: number;
}

export interface ProwlarrStats {
  indexers: ProwlarrIndexerStat[];
  userAgents: ProwlarrUserAgentStat[];
  hosts: ProwlarrHostStat[];
}

export interface ProwlarrHistoryRecord {
  id: number;
  indexerId: number;
  indexer: string;
  query: string;
  queryType: string;
  categories: number[];
  date: string;
  eventType: string;
  successful?: boolean;
  data: Record<string, string>;
}

export interface ProwlarrHistoryResponse {
  page: number;
  pageSize: number;
  sortKey: string;
  sortDirection: string;
  totalRecords: number;
  records: ProwlarrHistoryRecord[];
}

interface CommandResponse {
  id: number;
  name: string;
  commandName: string;
  status: string;
  queued: string;
}

export class ProwlarrClient {
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
    try {
      const response = await this.client.post<T>(endpoint, body);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.data) {
        const data = error.response.data;
        if (Array.isArray(data) && data[0]?.errorMessage) {
          throw new Error(data.map((e: { errorMessage: string }) => e.errorMessage).join(', '));
        }
        if (typeof data === 'object' && data !== null && 'message' in data) {
          throw new Error(String(data.message));
        }
      }
      throw error;
    }
  }

  private async delete<T>(endpoint: string): Promise<T> {
    const response = await this.client.delete<T>(endpoint);
    return response.data;
  }

  async getSystemStatus(): Promise<SystemStatus> {
    return this.get<SystemStatus>('/api/v1/system/status');
  }

  async getIndexers(): Promise<ProwlarrIndexer[]> {
    return this.get<ProwlarrIndexer[]>('/api/v1/indexer');
  }

  async deleteIndexer(id: number): Promise<void> {
    await this.delete(`/api/v1/indexer/${id}`);
  }

  async testAllIndexers(): Promise<ProwlarrTestAllResponse> {
    const response = await this.client.post<unknown>('/api/v1/indexer/testall', undefined, {
      validateStatus: (status) => (status >= 200 && status < 300) || status === 400,
    });

    if (Array.isArray(response.data) && response.data.every(isProwlarrIndexerTestResult)) {
      return normalizeProwlarrTestAllResponse(response.data);
    }

    throw new Error(`Unexpected test-all response (${response.status})`);
  }

  async getIndexer(id: number): Promise<ProwlarrIndexer> {
    return this.get<ProwlarrIndexer>(`/api/v1/indexer/${id}`);
  }

  async testIndexer(id: number): Promise<unknown> {
    const indexer = await this.getIndexer(id);
    return this.post('/api/v1/indexer/test', indexer);
  }

  async getIndexerStatuses(): Promise<ProwlarrIndexerStatus[]> {
    return this.get<ProwlarrIndexerStatus[]>('/api/v1/indexerstatus');
  }

  async getIndexerStats(params?: { startDate?: string }): Promise<ProwlarrStats> {
    return this.get<ProwlarrStats>('/api/v1/indexerstats', params as Record<string, unknown>);
  }

  async getHistory(params: { page?: number; pageSize?: number; indexerId?: number; eventType?: number; successful?: boolean } = {}): Promise<ProwlarrHistoryResponse> {
    return this.get<ProwlarrHistoryResponse>('/api/v1/history', params as Record<string, unknown>);
  }

  async sendCommand(name: string): Promise<CommandResponse> {
    return this.post<CommandResponse>('/api/v1/command', { name });
  }

  async getIndexerSchemas(): Promise<ProwlarrIndexer[]> {
    return this.get<ProwlarrIndexer[]>('/api/v1/indexer/schema');
  }

  async getAppProfiles(): Promise<ProwlarrAppProfile[]> {
    return this.get<ProwlarrAppProfile[]>('/api/v1/appprofile');
  }

  async addIndexer(body: Partial<ProwlarrIndexer>): Promise<ProwlarrIndexer> {
    return this.post<ProwlarrIndexer>('/api/v1/indexer', body);
  }
}
