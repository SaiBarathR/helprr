import axios, { AxiosInstance } from 'axios';
import { keepAliveHttpAgent, keepAliveHttpsAgent } from '@/lib/http-agents';
import { refuseRedirectToAnotherHost } from '@/lib/redirect-guard';
import { urlsToOrigins } from '@/lib/url-origins';
import type { HealthCheck, Tag } from '@/types/arr';

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
  capabilities?: { categories?: { id: number; name: string }[] };
  appProfileId?: number;
}

/**
 * The part of an indexer the browser gets. Prowlarr's `fields` hold the
 * indexer's settings and are masked only where Prowlarr marks a field as a
 * password or API key; a definition can keep a key in a field marked normal,
 * which Prowlarr returns in clear. So `fields`, and everything else the pages
 * do not use, stay on the server.
 */
export type ProwlarrIndexerSummary = Pick<
  ProwlarrIndexer,
  'id' | 'name' | 'enable' | 'protocol' | 'privacy' | 'priority' | 'implementationName' | 'tags' | 'appProfileId'
> & { categories: string[] };

export function toProwlarrIndexerSummary(indexer: ProwlarrIndexer): ProwlarrIndexerSummary {
  return {
    id: indexer.id,
    name: indexer.name,
    enable: indexer.enable,
    protocol: indexer.protocol,
    privacy: indexer.privacy,
    priority: indexer.priority,
    implementationName: indexer.implementationName,
    tags: indexer.tags,
    appProfileId: indexer.appProfileId,
    categories: (indexer.capabilities?.categories ?? [])
      .map((category) => category.name)
      .filter((name) => typeof name === 'string'),
  };
}

export interface ProwlarrBulkEdit {
  ids: number[];
  enable?: boolean;
  priority?: number;
  appProfileId?: number;
  tags?: number[];
  applyTags?: 'add' | 'remove' | 'replace';
}

export interface ProwlarrRelease {
  guid: string;
  indexerId: number;
  indexer?: string;
  title: string;
  size?: number;
  seeders?: number;
  leechers?: number;
  publishDate?: string;
  protocol?: string;
}

/** Server-side only: `fields` holds the arr's API key. */
export interface ProwlarrApplication {
  id: number;
  name: string;
  implementation: string;
  implementationName: string;
  syncLevel: string;
  enable: boolean;
  fields?: { name: string; value?: unknown }[];
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

// Prowlarr reports validation failures in the response body; surface those as
// the error message instead of axios's generic status text.
function throwUpstreamMessage(error: unknown): never {
  if (axios.isAxiosError(error) && error.response?.data) {
    const data = error.response.data;
    // Prowlarr's messages can quote an indexer URL with its key in it, and
    // the message is logged, so URLs are cut to their origin.
    if (Array.isArray(data) && data[0]?.errorMessage) {
      throw new Error(urlsToOrigins(data.map((e: { errorMessage: string }) => e.errorMessage).join(', ')));
    }
    if (typeof data === 'object' && data !== null && 'message' in data) {
      throw new Error(urlsToOrigins(String(data.message)));
    }
  }
  throw error;
}

export class ProwlarrClient {
  private client: AxiosInstance;

  constructor(url: string, apiKey: string, customHeaders?: Record<string, string>) {
    this.client = axios.create({
      baseURL: url.replace(/\/+$/, ''),
      headers: {
        ...customHeaders,
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
      httpAgent: keepAliveHttpAgent,
      httpsAgent: keepAliveHttpsAgent,
      beforeRedirect: refuseRedirectToAnotherHost,
    });
  }

  private async get<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    const response = await this.client.get<T>(endpoint, { params });
    return response.data;
  }

  private async post<T>(endpoint: string, body?: unknown, config?: { timeout?: number }): Promise<T> {
    try {
      const response = await this.client.post<T>(endpoint, body, config);
      return response.data;
    } catch (error) {
      throwUpstreamMessage(error);
    }
  }

  private async put<T>(endpoint: string, body?: unknown): Promise<T> {
    try {
      const response = await this.client.put<T>(endpoint, body);
      return response.data;
    } catch (error) {
      throwUpstreamMessage(error);
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
    return this.testAll('/api/v1/indexer/testall');
  }

  async testAllApplications(): Promise<ProwlarrTestAllResponse> {
    return this.testAll('/api/v1/applications/testall');
  }

  private async testAll(endpoint: string): Promise<ProwlarrTestAllResponse> {
    const response = await this.client.post<unknown>(endpoint, undefined, {
      validateStatus: (status) => (status >= 200 && status < 300) || status === 400,
      timeout: 120_000, // tests everything; slow/unreachable targets push this well past the default
    });

    if (Array.isArray(response.data) && response.data.every(isProwlarrIndexerTestResult)) {
      return normalizeProwlarrTestAllResponse(response.data);
    }

    throw new Error(`Unexpected test-all response (${response.status})`);
  }

  /**
   * Prowlarr's bulk editor changes only the properties sent, with no full
   * settings round trip. Its response holds whole indexers, settings included,
   * so it is not returned.
   */
  async bulkEditIndexers(body: ProwlarrBulkEdit): Promise<void> {
    await this.put('/api/v1/indexer/bulk', body);
  }

  /** A search can take as long as the slowest indexer. */
  async searchReleases(
    { query, categories }: { query: string; categories: number[] },
    signal?: AbortSignal,
  ): Promise<ProwlarrRelease[]> {
    const params = new URLSearchParams({ query, type: 'search' });
    categories.forEach((category) => params.append('categories', String(category)));
    const response = await this.client.get<ProwlarrRelease[]>(`/api/v1/search?${params}`, {
      timeout: 120_000,
      signal,
    });
    return response.data;
  }

  /** Prowlarr finds the release by indexer and guid in its own search cache. */
  async grabRelease({ guid, indexerId }: { guid: string; indexerId: number }): Promise<void> {
    await this.post('/api/v1/search', { guid, indexerId }, { timeout: 60_000 });
  }

  async getApplications(): Promise<ProwlarrApplication[]> {
    return this.get<ProwlarrApplication[]>('/api/v1/applications');
  }

  async testApplication(id: number): Promise<void> {
    const application = await this.get<ProwlarrApplication>(`/api/v1/applications/${id}`);
    await this.post('/api/v1/applications/test', application, { timeout: 60_000 });
  }

  async getTags(): Promise<Tag[]> {
    return this.get<Tag[]>('/api/v1/tag');
  }

  async getHealth(): Promise<HealthCheck[]> {
    return this.get<HealthCheck[]>('/api/v1/health');
  }

  async getIndexer(id: number): Promise<ProwlarrIndexer> {
    return this.get<ProwlarrIndexer>(`/api/v1/indexer/${id}`);
  }

  async testIndexer(id: number): Promise<unknown> {
    const indexer = await this.getIndexer(id);
    return this.post('/api/v1/indexer/test', indexer, { timeout: 120_000 });
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

  async getAppProfiles(): Promise<ProwlarrAppProfile[]> {
    return this.get<ProwlarrAppProfile[]>('/api/v1/appprofile');
  }
}
