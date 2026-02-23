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
  JellyfinUser,
  JellyfinScheduledTask,
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

  constructor(url: string, token: string, userId: string) {
    this.serverUrl = url.replace(/\/+$/, '');
    this.userId = userId;
      this.client = axios.create({
        baseURL: this.serverUrl,
        headers: {
          'Authorization': `MediaBrowser Token="${token}", Client="${CLIENT_NAME}", Device="${DEVICE_NAME}", DeviceId="${DEVICE_ID}", Version="${CLIENT_VERSION}"`,
          'Content-Type': 'application/json',
        },
        timeout: 30000, // 30 second timeout
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

  // --- Native API: Users & Tasks ---

  async getUsers(): Promise<JellyfinUser[]> {
    return this.get<JellyfinUser[]>('/Users');
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
    } catch {
      return null;
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
    } catch {
      return null;
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
    } catch {
      return null;
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
    } catch {
      return null;
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
    } catch {
      return null;
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
    } catch {
      return null;
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
    } catch {
      return null;
    }
  }

  async getTypeFilterList(): Promise<string[] | null> {
    try {
      return await this.get<string[]>('/user_usage_stats/type_filter_list');
    } catch {
      return null;
    }
  }

  async getUserList(): Promise<Array<{ name: string; id: string }> | null> {
    try {
      return await this.get<Array<{ name: string; id: string }>>('/user_usage_stats/user_list', {
        stamp: Date.now(),
      });
    } catch {
      return null;
    }
  }

  /** Runs a raw SQL query against the plugin's PlaybackActivity table. */
  async submitCustomQuery(sql: string): Promise<{ columns: string[]; results: string[][] } | null> {
    try {
      const response = await this.client.post('/user_usage_stats/submit_custom_query', {
        CustomQueryString: sql,
      });
      const data = response.data as { columns?: unknown; results?: unknown } | null;
      const columns = data?.columns;
      const results = data?.results;
      if (!Array.isArray(columns) || !columns.every((column) => typeof column === 'string')) {
        return null;
      }
      if (!Array.isArray(results) || !results.every((row) => Array.isArray(row) && row.every((cell) => typeof cell === 'string'))) {
        return null;
      }
      return { columns, results };
    } catch {
      return null;
    }
  }
}
