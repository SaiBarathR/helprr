import axios, { AxiosInstance } from 'axios';
import type {
  JellyfinAuthResponse,
  JellyfinSystemInfo,
  JellyfinLibrary,
  JellyfinItem,
  JellyfinItemsResponse,
  JellyfinSession,
  JellyfinItemCounts,
  JellyfinSearchResult,
  JellyfinActivityResponse,
} from '@/types/jellyfin';

const CLIENT_NAME = 'Helprr';
const CLIENT_VERSION = '1.0.0';
const DEVICE_NAME = 'Helprr Server';
const DEVICE_ID = 'helprr-server';

export class JellyfinClient {
  private client: AxiosInstance;
  private serverUrl: string;
  private userId: string;

  constructor(url: string, token: string, userId: string) {
    this.serverUrl = url.replace(/\/+$/, '');
    this.userId = userId;
    this.client = axios.create({
      baseURL: this.serverUrl,
      headers: {
        'Authorization': `MediaBrowser Token="${token}", Client="${CLIENT_NAME}", Device="${DEVICE_NAME}", DeviceId="${DEVICE_ID}", Version="${CLIENT_VERSION}"`,
        'Content-Type': 'application/json',
      },
    });
  }

  static async authenticate(
    url: string,
    username: string,
    password: string
  ): Promise<JellyfinAuthResponse> {
    const cleanUrl = url.replace(/\/+$/, '');
    const response = await axios.post<JellyfinAuthResponse>(
      `${cleanUrl}/Users/AuthenticateByName`,
      { Username: username, Pw: password },
      {
        headers: {
          'Authorization': `MediaBrowser Client="${CLIENT_NAME}", Device="${DEVICE_NAME}", DeviceId="${DEVICE_ID}", Version="${CLIENT_VERSION}"`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data;
  }

  getServerUrl(): string {
    return this.serverUrl;
  }

  getImageUrl(
    itemId: string,
    type: string = 'Primary',
    params: Record<string, string | number> = {}
  ): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      query.set(key, String(value));
    }
    const qs = query.toString();
    return `${this.serverUrl}/Items/${itemId}/Images/${type}${qs ? `?${qs}` : ''}`;
  }

  private async get<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
    const response = await this.client.get<T>(endpoint, { params });
    return response.data;
  }

  async getSystemInfo(): Promise<JellyfinSystemInfo> {
    return this.get<JellyfinSystemInfo>('/System/Info');
  }

  async getLibraries(): Promise<JellyfinLibrary[]> {
    const data = await this.get<{ Items: JellyfinLibrary[] }>(`/Users/${this.userId}/Views`);
    return data.Items;
  }

  async getItems(params: Record<string, unknown> = {}): Promise<JellyfinItemsResponse> {
    return this.get<JellyfinItemsResponse>(`/Users/${this.userId}/Items`, params);
  }

  async getRecentlyAdded(params: { limit?: number; parentId?: string } = {}): Promise<JellyfinItem[]> {
    return this.get<JellyfinItem[]>(`/Users/${this.userId}/Items/Latest`, {
      Limit: params.limit ?? 15,
      ...(params.parentId && { ParentId: params.parentId }),
      Fields: 'Overview,DateCreated,ImageTags',
      EnableImageTypes: 'Primary,Backdrop',
    });
  }

  async getResumeItems(params: { limit?: number } = {}): Promise<JellyfinItemsResponse> {
    return this.get<JellyfinItemsResponse>(`/UserItems/Resume`, {
      UserId: this.userId,
      Limit: params.limit ?? 10,
      Fields: 'Overview,ImageTags',
      EnableImageTypes: 'Primary,Backdrop',
      MediaTypes: 'Video',
    });
  }

  async getSessions(): Promise<JellyfinSession[]> {
    return this.get<JellyfinSession[]>('/Sessions');
  }

  async getActiveSessions(): Promise<JellyfinSession[]> {
    const sessions = await this.getSessions();
    return sessions.filter((s) => s.NowPlayingItem);
  }

  async getItemCounts(): Promise<JellyfinItemCounts> {
    return this.get<JellyfinItemCounts>('/Items/Counts', { UserId: this.userId });
  }

  async search(term: string): Promise<JellyfinSearchResult> {
    return this.get<JellyfinSearchResult>('/Search/Hints', {
      searchTerm: term,
      Limit: 20,
      UserId: this.userId,
    });
  }

  async getActivityLog(params: { startIndex?: number; limit?: number; minDate?: string } = {}): Promise<JellyfinActivityResponse> {
    return this.get<JellyfinActivityResponse>('/System/ActivityLog/Entries', {
      StartIndex: params.startIndex ?? 0,
      Limit: params.limit ?? 50,
      ...(params.minDate && { MinDate: params.minDate }),
    });
  }
}
