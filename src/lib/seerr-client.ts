import axios, { AxiosInstance } from 'axios';
import type {
  SeerrMediaDetail,
  SeerrPaginated,
  SeerrRequest,
  SeerrRequestCount,
  SeerrRequestFilter,
  SeerrRequestSort,
  SeerrSortDirection,
  SeerrStatus,
  SeerrUserQuota,
  SeerrUserSummary,
} from '@/types/seerr';

export interface SeerrListRequestParams {
  take?: number;
  skip?: number;
  filter?: SeerrRequestFilter;
  sort?: SeerrRequestSort;
  sortDirection?: SeerrSortDirection;
  requestedBy?: number;
}

export interface SeerrListUserParams {
  take?: number;
  skip?: number;
  sort?: 'created' | 'updated' | 'requests' | 'displayname';
}

export class SeerrClient {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor(url: string, apiKey: string) {
    this.baseUrl = url.replace(/\/+$/, '');
    this.client = axios.create({
      baseURL: `${this.baseUrl}/api/v1`,
      headers: {
        'X-Api-Key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 30000,
    });
  }

  getServerUrl(): string {
    return this.baseUrl;
  }

  private async get<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    const response = await this.client.get<T>(endpoint, { params });
    return response.data;
  }

  private async post<T>(endpoint: string, body?: unknown): Promise<T> {
    const response = await this.client.post<T>(endpoint, body ?? {});
    return response.data;
  }

  private async del<T>(endpoint: string): Promise<T> {
    const response = await this.client.delete<T>(endpoint);
    return response.data;
  }

  async verify(): Promise<SeerrUserSummary> {
    return this.get<SeerrUserSummary>('/auth/me');
  }

  async getStatus(): Promise<SeerrStatus> {
    return this.get<SeerrStatus>('/status');
  }

  async listRequests(params: SeerrListRequestParams = {}): Promise<SeerrPaginated<SeerrRequest>> {
    return this.get<SeerrPaginated<SeerrRequest>>('/request', {
      take: params.take ?? 20,
      skip: params.skip ?? 0,
      filter: params.filter ?? 'all',
      sort: params.sort ?? 'added',
      sortDirection: params.sortDirection ?? 'desc',
      ...(params.requestedBy !== undefined ? { requestedBy: params.requestedBy } : {}),
    });
  }

  async getRequestCount(): Promise<SeerrRequestCount> {
    return this.get<SeerrRequestCount>('/request/count');
  }

  async getRequest(id: number): Promise<SeerrRequest> {
    return this.get<SeerrRequest>(`/request/${id}`);
  }

  async approveRequest(id: number): Promise<SeerrRequest> {
    return this.post<SeerrRequest>(`/request/${id}/approve`);
  }

  async declineRequest(id: number): Promise<SeerrRequest> {
    return this.post<SeerrRequest>(`/request/${id}/decline`);
  }

  async retryRequest(id: number): Promise<SeerrRequest> {
    return this.post<SeerrRequest>(`/request/${id}/retry`);
  }

  async deleteRequest(id: number): Promise<void> {
    await this.del(`/request/${id}`);
  }

  async getMediaDetail(
    mediaType: 'movie' | 'tv',
    tmdbId: number
  ): Promise<SeerrMediaDetail> {
    return this.get<SeerrMediaDetail>(`/${mediaType}/${tmdbId}`);
  }

  /**
   * Create a new Overseerr/Jellyseerr request.
   *
   * For TV requests, callers may pass an array of season numbers, the literal
   * string `'all'`, or omit `seasons` entirely (Seerr's default is "all"). The
   * `is4k` flag falls back to false to match the standard non-4K request flow.
   */
  async createRequest(params: {
    mediaType: 'movie' | 'tv';
    mediaId: number;
    is4k?: boolean;
    seasons?: number[] | 'all';
  }): Promise<SeerrRequest> {
    const body: Record<string, unknown> = {
      mediaType: params.mediaType,
      mediaId: params.mediaId,
      is4k: params.is4k ?? false,
    };
    if (params.mediaType === 'tv' && params.seasons !== undefined) {
      body.seasons = params.seasons;
    }
    return this.post<SeerrRequest>('/request', body);
  }

  async listUsers(params: SeerrListUserParams = {}): Promise<SeerrPaginated<SeerrUserSummary>> {
    return this.get<SeerrPaginated<SeerrUserSummary>>('/user', {
      take: params.take ?? 100,
      skip: params.skip ?? 0,
      sort: params.sort ?? 'displayname',
    });
  }

  async getUserRequests(
    userId: number,
    params: { take?: number; skip?: number } = {}
  ): Promise<SeerrPaginated<SeerrRequest>> {
    return this.get<SeerrPaginated<SeerrRequest>>(`/user/${userId}/requests`, {
      take: params.take ?? 20,
      skip: params.skip ?? 0,
    });
  }

  async getUserQuota(userId: number): Promise<SeerrUserQuota> {
    return this.get<SeerrUserQuota>(`/user/${userId}/quota`);
  }
}
