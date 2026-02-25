import axios, { AxiosInstance } from 'axios';
import type {
  JellyfinSystemInfo,
  JellyfinLibrary,
  JellyfinItem,
  JellyfinItemsResponse,
  JellyfinSession,
  JellyfinItemCounts,
  JellyfinSearchResult,
  JellyfinActivityResponse,
  JellyfinUser,
  JellyfinScheduledTask,
  JellyfinAuthKey,
  PlaybackUserActivity,
  PlaybackActivityItem,
  PlaybackBreakdownEntry,
} from '@/types/jellyfin';

const CLIENT_NAME = 'Helprr';
const CLIENT_VERSION = '1.0.0';
const DEVICE_NAME = 'Helprr Server';
const DEVICE_ID = 'helprr-server';

export class JellyfinClient {
  private client: AxiosInstance;
  private serverUrl: string;
  private userId: string;

  constructor(url: string, token: string, userId: string = '') {
    this.serverUrl = url.replace(/\/+$/, '');
    this.userId = userId;
    this.client = axios.create({
      baseURL: this.serverUrl,
      headers: {
        'Authorization': `MediaBrowser Token="${token}", Client="${CLIENT_NAME}", Device="${DEVICE_NAME}", DeviceId="${DEVICE_ID}", Version="${CLIENT_VERSION}"`,
        'X-Emby-Token': token,
        'Content-Type': 'application/json',
      },
      timeout: 30000, // 30 second timeout
    });
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

  private requireUserId(): string {
    if (!this.userId) {
      throw new Error('Jellyfin userId is not configured. Re-test and save Jellyfin settings.');
    }
    return this.userId;
  }

  private isPluginMissingError(error: unknown): boolean {
    return axios.isAxiosError(error) && error.response?.status === 404;
  }

  private isBadRequestError(error: unknown): boolean {
    return axios.isAxiosError(error) && error.response?.status === 400;
  }

  private isUnauthorizedError(error: unknown): boolean {
    return axios.isAxiosError(error) && error.response?.status === 401;
  }

  private isForbiddenError(error: unknown): boolean {
    return axios.isAxiosError(error) && error.response?.status === 403;
  }

  private isNotFoundError(error: unknown): boolean {
    return axios.isAxiosError(error) && error.response?.status === 404;
  }

  private canFallbackUserResolution(error: unknown): boolean {
    return this.isBadRequestError(error) || this.isUnauthorizedError(error) || this.isForbiddenError(error) || this.isNotFoundError(error);
  }

  private pickPreferredUser(users: JellyfinUser[]): JellyfinUser | null {
    if (users.length === 0) return null;
    const activeUsers = users.filter((user) => !user.Policy?.IsHidden && !user.Policy?.IsDisabled);
    const pool = activeUsers.length > 0 ? activeUsers : users;

    const adminNamed = pool.find((user) => user.Policy?.IsAdministrator && user.Name.toLowerCase() === 'admin');
    if (adminNamed) return adminNamed;

    const anyAdmin = pool.find((user) => user.Policy?.IsAdministrator);
    if (anyAdmin) return anyAdmin;

    return pool[0] ?? null;
  }

  async getSystemInfo(): Promise<JellyfinSystemInfo> {
    return this.get<JellyfinSystemInfo>('/System/Info');
  }

  async getCurrentUser(): Promise<JellyfinUser> {
    return this.get<JellyfinUser>('/Users/Me');
  }

  async getLibraries(): Promise<JellyfinLibrary[]> {
    const data = await this.get<{ Items: JellyfinLibrary[] }>(`/Users/${this.requireUserId()}/Views`);
    return data.Items;
  }

  async getItems(params: Record<string, unknown> = {}): Promise<JellyfinItemsResponse> {
    return this.get<JellyfinItemsResponse>(`/Users/${this.requireUserId()}/Items`, params);
  }

  async getRecentlyAdded(params: { limit?: number; parentId?: string } = {}): Promise<JellyfinItem[]> {
    return this.get<JellyfinItem[]>(`/Users/${this.requireUserId()}/Items/Latest`, {
      Limit: params.limit ?? 15,
      ...(params.parentId && { ParentId: params.parentId }),
      Fields: 'Overview,DateCreated,ImageTags',
      EnableImageTypes: 'Primary,Backdrop',
    });
  }

  async getResumeItems(params: { limit?: number } = {}): Promise<JellyfinItemsResponse> {
    return this.get<JellyfinItemsResponse>(`/UserItems/Resume`, {
      UserId: this.requireUserId(),
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
    return this.get<JellyfinItemCounts>('/Items/Counts', { UserId: this.requireUserId() });
  }

  async search(term: string): Promise<JellyfinSearchResult> {
    return this.get<JellyfinSearchResult>('/Search/Hints', {
      searchTerm: term,
      Limit: 20,
      UserId: this.requireUserId(),
    });
  }

  async getActivityLog(params: { startIndex?: number; limit?: number; minDate?: string } = {}): Promise<JellyfinActivityResponse> {
    return this.get<JellyfinActivityResponse>('/System/ActivityLog/Entries', {
      StartIndex: params.startIndex ?? 0,
      Limit: params.limit ?? 50,
      ...(params.minDate && { MinDate: params.minDate }),
    });
  }

  // --- Native API: Users & Tasks ---

  async getUsers(): Promise<JellyfinUser[]> {
    return this.get<JellyfinUser[]>('/Users');
  }

  async getAuthKeys(): Promise<JellyfinAuthKey[]> {
    const data = await this.get<{ Items?: JellyfinAuthKey[] } | JellyfinAuthKey[]>('/Auth/Keys');
    if (Array.isArray(data)) return data;
    return Array.isArray(data.Items) ? data.Items : [];
  }

  /**
   * Some Jellyfin API-key flows reject /Users/Me with 400.
   * In that case, fall back to resolving the key owner through /Auth/Keys + /Users.
   */
  async resolveCurrentUser(apiKey: string): Promise<JellyfinUser | null> {
    let users: JellyfinUser[] | null = null;

    try {
      return await this.getCurrentUser();
    } catch (error) {
      if (!this.canFallbackUserResolution(error)) throw error;
    }

    try {
      users = await this.getUsers();
    } catch (error) {
      if (!this.canFallbackUserResolution(error)) throw error;
    }

    try {
      const keys = await this.getAuthKeys();
      const matchingKey = keys.find((key) => key.AccessToken === apiKey && typeof key.UserId === 'string');
      if (matchingKey?.UserId && users) {
        const resolved = users.find((user) => user.Id === matchingKey.UserId);
        if (resolved) return resolved;
      }
    } catch (error) {
      if (!this.canFallbackUserResolution(error)) throw error;
    }

    if (users) {
      return this.pickPreferredUser(users);
    }

    return null;
  }

  async hasAdminAccess(): Promise<boolean> {
    try {
      await this.getScheduledTasks();
      return true;
    } catch (error) {
      if (this.isUnauthorizedError(error) || this.isForbiddenError(error)) {
        return false;
      }
      throw error;
    }
  }

  async getScheduledTasks(): Promise<JellyfinScheduledTask[]> {
    return this.get<JellyfinScheduledTask[]>('/ScheduledTasks');
  }

  // --- Playback Reporting Plugin methods ---
  // All under /user_usage_stats/ — returns null if plugin not installed (404)
  // Param conventions from HAR:
  //   stamp: Date.now() (ms cache-buster)
  //   timezoneOffset: positive UTC offset (e.g. 5.5 for UTC+5:30)
  //   endDate: YYYY-MM-DD
  //   filter: comma-separated type names e.g. "Movie,Episode,Audio" (REQUIRED for data)
  //   days: integer lookback

  /** UTC offset as positive number (e.g. 5.5 for UTC+5:30). Server TZ based. */
  private getTzOffset(): number {
    return -(new Date().getTimezoneOffset() / 60);
  }

  private todayStr(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // --- user_activity: no timezoneOffset per HAR ---
  async getPlaybackUserActivity(days: number, endDate?: string): Promise<PlaybackUserActivity[] | null> {
    try {
      return await this.get<PlaybackUserActivity[]>('/user_usage_stats/user_activity', {
        days,
        endDate: endDate || this.todayStr(),
        stamp: Date.now(),
      });
    } catch (error) {
      if (this.isPluginMissingError(error)) return null;
      throw error;
    }
  }

  // --- GetItems: filter is REQUIRED or returns [] ---
  async getPlaybackHistory(
    userId: string,
    date: string,
    filter: string
  ): Promise<PlaybackActivityItem[] | null> {
    try {
      return await this.get<PlaybackActivityItem[]>(`/user_usage_stats/${userId}/${date}/GetItems`, {
        filter,
      });
    } catch (error) {
      if (this.isPluginMissingError(error)) return null;
      throw error;
    }
  }

  // --- PlayActivity: returns [{user_id, user_name, user_usage: {date: val}}] ---
  async getPlayActivity(
    days: number,
    endDate: string,
    filter: string,
    dataType: string = 'count'
  ): Promise<Array<{ user_id: string; user_name: string; user_usage: Record<string, number> }> | null> {
    try {
      return await this.get('/user_usage_stats/PlayActivity', {
        days,
        endDate,
        filter,
        dataType,
        stamp: Date.now(),
        timezoneOffset: this.getTzOffset(),
      });
    } catch (error) {
      if (this.isPluginMissingError(error)) return null;
      throw error;
    }
  }

  // --- HourlyReport: returns {"dayIdx-hour": minutes} ---
  async getHourlyReport(
    days: number,
    endDate: string,
    filter: string
  ): Promise<Record<string, number> | null> {
    try {
      return await this.get<Record<string, number>>('/user_usage_stats/HourlyReport', {
        days,
        endDate,
        filter,
        stamp: Date.now(),
        timezoneOffset: this.getTzOffset(),
      });
    } catch (error) {
      if (this.isPluginMissingError(error)) return null;
      throw error;
    }
  }

  async getBreakdownReport(
    type: string,
    days: number,
    endDate: string
  ): Promise<PlaybackBreakdownEntry[] | null> {
    try {
      return await this.get<PlaybackBreakdownEntry[]>(`/user_usage_stats/${type}/BreakdownReport`, {
        days,
        endDate,
        stamp: Date.now(),
        timezoneOffset: this.getTzOffset(),
      });
    } catch (error) {
      if (this.isPluginMissingError(error)) return null;
      throw error;
    }
  }

  async getTvShowsReport(
    days: number,
    endDate: string
  ): Promise<PlaybackBreakdownEntry[] | null> {
    try {
      return await this.get<PlaybackBreakdownEntry[]>('/user_usage_stats/GetTvShowsReport', {
        days,
        endDate,
        stamp: Date.now(),
        timezoneOffset: this.getTzOffset(),
      });
    } catch (error) {
      if (this.isPluginMissingError(error)) return null;
      throw error;
    }
  }

  async getMoviesReport(
    days: number,
    endDate: string
  ): Promise<PlaybackBreakdownEntry[] | null> {
    try {
      return await this.get<PlaybackBreakdownEntry[]>('/user_usage_stats/MoviesReport', {
        days,
        endDate,
        stamp: Date.now(),
        timezoneOffset: this.getTzOffset(),
      });
    } catch (error) {
      if (this.isPluginMissingError(error)) return null;
      throw error;
    }
  }

  async getTypeFilterList(): Promise<string[] | null> {
    try {
      return await this.get<string[]>('/user_usage_stats/type_filter_list');
    } catch (error) {
      if (this.isPluginMissingError(error)) return null;
      throw error;
    }
  }

  async getUserList(): Promise<Array<{ name: string; id: string }> | null> {
    try {
      return await this.get<Array<{ name: string; id: string }>>('/user_usage_stats/user_list', {
        stamp: Date.now(),
      });
    } catch (error) {
      if (this.isPluginMissingError(error)) return null;
      throw error;
    }
  }

  /** Runs a raw SQL query against the plugin's PlaybackActivity table. */
  async submitCustomQuery(sql: string): Promise<{ columns: string[]; results: string[][] } | null> {
    try {
      const response = await this.client.post('/user_usage_stats/submit_custom_query', {
        CustomQueryString: sql,
      });
      const data = response.data as { columns?: unknown; colums?: unknown; results?: unknown } | null;
      const columns = data?.columns ?? data?.colums;
      const results = data?.results;

      if (!Array.isArray(columns) || !Array.isArray(results)) {
        throw new Error('Unexpected submit_custom_query response format');
      }

      const normalizedColumns = columns.map((column) => String(column ?? ''));
      const normalizedResults = results.map((row) => {
        if (!Array.isArray(row)) {
          throw new Error('Unexpected submit_custom_query row format');
        }
        return row.map((cell) => {
          if (cell == null) return '';
          if (typeof cell === 'string') return cell;
          if (typeof cell === 'number' || typeof cell === 'boolean' || typeof cell === 'bigint') {
            return String(cell);
          }
          return JSON.stringify(cell);
        });
      });

      return {
        columns: normalizedColumns,
        results: normalizedResults,
      };
    } catch (error) {
      if (this.isPluginMissingError(error)) return null;
      throw error;
    }
  }
}
