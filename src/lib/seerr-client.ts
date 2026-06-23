import axios, { AxiosInstance } from 'axios';
import type {
  SeerrMediaDetail,
  SeerrMediaType,
  SeerrPaginated,
  SeerrRequest,
  SeerrRequestCount,
  SeerrRequestFilter,
  SeerrRequestSort,
  SeerrSortDirection,
  SeerrStatus,
  SeerrUserQuota,
  SeerrUserSummary,
  SeerrServiceData,
  SeerrSeasonInfo,
} from '@/types/seerr';

/** Overrides shared by create + edit (PUT) — all optional; omitted = Seerr default. */
export interface SeerrRequestOverrides {
  serverId?: number;
  profileId?: number;
  rootFolder?: string;
  languageProfileId?: number;
  tags?: number[];
}

// Raw Overseerr/Jellyseerr API shapes (internal — normalized before leaving the client).
interface RawServiceServer {
  id: number;
  name: string;
  is4k?: boolean;
  isDefault?: boolean;
  activeProfileId?: number;
  activeDirectory?: string;
  activeTags?: number[];
}
interface RawServiceDetail {
  profiles?: { id: number; name: string }[];
  rootFolders?: { id: number; path: string; freeSpace?: number }[];
  tags?: { id: number; label: string }[];
}
interface RawTvDetail {
  seasons?: { seasonNumber: number; episodeCount?: number; name?: string }[];
  mediaInfo?: { seasons?: { seasonNumber: number; status: number }[] } | null;
}

export interface SeerrListRequestParams {
  take?: number;
  skip?: number;
  filter?: SeerrRequestFilter;
  sort?: SeerrRequestSort;
  sortDirection?: SeerrSortDirection;
  requestedBy?: number;
  mediaType?: SeerrMediaType;
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

  private async put<T>(endpoint: string, body?: unknown): Promise<T> {
    const response = await this.client.put<T>(endpoint, body ?? {});
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
      ...(params.mediaType ? { mediaType: params.mediaType } : {}),
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
   * string `'all'`, or omit `seasons` entirely. Seerr's POST /request rejects a
   * TV request whose `seasons` is missing/empty, so we send `'all'` explicitly
   * when no seasons are given rather than omitting the field. The `is4k` flag
   * falls back to false to match the standard non-4K request flow.
   */
  async createRequest(params: {
    mediaType: 'movie' | 'tv';
    mediaId: number;
    is4k?: boolean;
    seasons?: number[] | 'all';
    // Attribute the request to a specific Seerr user (counted against their
    // quota). Helprr acts on the mapped user's behalf with the single admin key.
    userId?: number;
  } & SeerrRequestOverrides): Promise<SeerrRequest> {
    const body: Record<string, unknown> = {
      mediaType: params.mediaType,
      mediaId: params.mediaId,
      is4k: params.is4k ?? false,
    };
    if (typeof params.userId === 'number') body.userId = params.userId;
    if (typeof params.serverId === 'number') body.serverId = params.serverId;
    if (typeof params.profileId === 'number') body.profileId = params.profileId;
    if (typeof params.rootFolder === 'string' && params.rootFolder) body.rootFolder = params.rootFolder;
    if (typeof params.languageProfileId === 'number') body.languageProfileId = params.languageProfileId;
    if (Array.isArray(params.tags)) body.tags = params.tags;
    if (params.mediaType === 'tv') {
      body.seasons =
        Array.isArray(params.seasons) && params.seasons.length === 0
          ? 'all'
          : params.seasons ?? 'all';
    }
    return this.post<SeerrRequest>('/request', body);
  }

  /** Edit a pending request (PUT /request/{id}) — used by the admin approve/edit modal. */
  async updateRequest(
    id: number,
    params: { mediaType: 'movie' | 'tv'; seasons?: number[] | 'all'; userId?: number } & SeerrRequestOverrides
  ): Promise<SeerrRequest> {
    const body: Record<string, unknown> = { mediaType: params.mediaType };
    if (typeof params.userId === 'number') body.userId = params.userId;
    if (typeof params.serverId === 'number') body.serverId = params.serverId;
    if (typeof params.profileId === 'number') body.profileId = params.profileId;
    if (typeof params.rootFolder === 'string' && params.rootFolder) body.rootFolder = params.rootFolder;
    if (typeof params.languageProfileId === 'number') body.languageProfileId = params.languageProfileId;
    if (Array.isArray(params.tags)) body.tags = params.tags;
    if (params.mediaType === 'tv' && params.seasons !== undefined) {
      body.seasons = params.seasons;
    }
    return this.put<SeerrRequest>(`/request/${id}`, body);
  }

  /**
   * Resolve the default Radarr/Sonarr server's quality profiles, root folders and
   * tags for the request/approve modal. Two calls: the list endpoint gives the
   * default server + its active defaults; the detail endpoint gives the options.
   */
  async getServiceData(service: 'radarr' | 'sonarr', is4k = false): Promise<SeerrServiceData> {
    const servers = await this.get<RawServiceServer[]>(`/service/${service}`);
    const chosen =
      servers.find((s) => s.isDefault && !!s.is4k === is4k) ??
      servers.find((s) => s.isDefault) ??
      servers[0];
    if (!chosen) {
      return {
        serverId: null,
        profiles: [],
        rootFolders: [],
        tags: [],
        defaultProfileId: null,
        defaultRootFolder: null,
        defaultTags: [],
      };
    }
    const detail = await this.get<RawServiceDetail>(`/service/${service}/${chosen.id}`);
    return {
      serverId: chosen.id,
      profiles: (detail.profiles ?? []).map((p) => ({ id: p.id, name: p.name })),
      rootFolders: (detail.rootFolders ?? []).map((r) => ({
        id: r.id,
        path: r.path,
        freeSpace: r.freeSpace,
      })),
      tags: (detail.tags ?? []).map((t) => ({ id: t.id, label: t.label })),
      defaultProfileId: chosen.activeProfileId ?? null,
      defaultRootFolder: chosen.activeDirectory ?? null,
      defaultTags: chosen.activeTags ?? [],
    };
  }

  /** TV season list (numbers + episode counts) merged with per-season Seerr status. */
  async getTvSeasons(tmdbId: number): Promise<SeerrSeasonInfo[]> {
    const detail = await this.get<RawTvDetail>(`/tv/${tmdbId}`);
    const statusBySeason = new Map<number, number>();
    for (const s of detail.mediaInfo?.seasons ?? []) {
      statusBySeason.set(s.seasonNumber, s.status);
    }
    return (detail.seasons ?? [])
      // Season 0 is "Specials" — Seerr's modal hides it from the request table.
      .filter((s) => s.seasonNumber > 0)
      .map((s) => ({
        seasonNumber: s.seasonNumber,
        episodeCount: s.episodeCount ?? 0,
        name: s.name,
        status: (statusBySeason.get(s.seasonNumber) as SeerrSeasonInfo['status']) ?? null,
      }));
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
