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
  JellyfinPlaybackInfoResponse,
  JellyfinMediaSource,
  JellyfinPlaybackReportBody,
} from '@/types/jellyfin';

const CLIENT_NAME = 'Helprr';
const CLIENT_VERSION = '1.0.0';
const DEVICE_NAME = 'Helprr Web';
const DEVICE_ID = 'helprr-web';

interface BuildStreamOptions {
  playSessionId?: string;
  startTimeTicks?: number;
  maxStreamingBitrate?: number;
  deviceId?: string;
}

export interface JellyfinStreamInfo {
  url: string;
  mimeType: string;
  isHls: boolean;
  playMethod: 'DirectPlay' | 'DirectStream' | 'Transcode';
  playSessionId: string;
}

export class JellyfinClient {
  private client: AxiosInstance;
  private serverUrl: string;
  private userId: string;
  private token: string;

  constructor(url: string, token: string, userId: string) {
    this.serverUrl = url.replace(/\/+$/, '');
    this.userId = userId;
    this.token = token;
    this.client = axios.create({
      baseURL: this.serverUrl,
      headers: {
        Authorization: `MediaBrowser Token="${token}", Client="${CLIENT_NAME}", Device="${DEVICE_NAME}", DeviceId="${DEVICE_ID}", Version="${CLIENT_VERSION}"`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  static async authenticate(
    url: string,
    username: string,
    password: string,
  ): Promise<JellyfinAuthResponse> {
    const cleanUrl = url.replace(/\/+$/, '');
    const response = await axios.post<JellyfinAuthResponse>(
      `${cleanUrl}/Users/AuthenticateByName`,
      { Username: username, Pw: password },
      {
        headers: {
          Authorization: `MediaBrowser Client="${CLIENT_NAME}", Device="${DEVICE_NAME}", DeviceId="${DEVICE_ID}", Version="${CLIENT_VERSION}"`,
          'Content-Type': 'application/json',
        },
      },
    );
    return response.data;
  }

  getServerUrl(): string {
    return this.serverUrl;
  }

  getUserId(): string {
    return this.userId;
  }

  getAccessToken(): string {
    return this.token;
  }

  toAbsoluteUrl(pathOrUrl: string): string {
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    return `${this.serverUrl}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
  }

  withApiKey(url: string): string {
    const parsed = new URL(url, this.serverUrl);
    if (!parsed.searchParams.has('ApiKey') && !parsed.searchParams.has('api_key')) {
      parsed.searchParams.set('ApiKey', this.token);
    }
    return parsed.toString();
  }

  getImageUrl(
    itemId: string,
    type: string = 'Primary',
    params: Record<string, string | number> = {},
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

  private async post<T>(endpoint: string, body?: unknown, params?: Record<string, unknown>): Promise<T> {
    const response = await this.client.post<T>(endpoint, body, { params });
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

  async getGlobalItems(params: Record<string, unknown> = {}): Promise<JellyfinItemsResponse> {
    return this.get<JellyfinItemsResponse>('/Items', {
      UserId: this.userId,
      ...params,
    });
  }

  async getItem(itemId: string): Promise<JellyfinItem> {
    return this.get<JellyfinItem>(`/Items/${itemId}`, {
      UserId: this.userId,
      Fields: 'ProviderIds,MediaSources,MediaStreams,UserData,Overview,ImageTags,BackdropImageTags,SeriesName,ParentIndexNumber,IndexNumber,ProductionYear',
    });
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
    return this.get<JellyfinItemsResponse>('/UserItems/Resume', {
      UserId: this.userId,
      Limit: params.limit ?? 10,
      Fields: 'Overview,ImageTags,ProviderIds,SeriesName,ParentIndexNumber,IndexNumber',
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

  async getPlaybackInfo(itemId: string, payload: Record<string, unknown>): Promise<JellyfinPlaybackInfoResponse> {
    return this.post<JellyfinPlaybackInfoResponse>(`/Items/${itemId}/PlaybackInfo`, payload);
  }

  async reportPlaybackStart(payload: JellyfinPlaybackReportBody): Promise<void> {
    await this.post<void>('/Sessions/Playing', payload);
  }

  async reportPlaybackProgress(payload: JellyfinPlaybackReportBody): Promise<void> {
    await this.post<void>('/Sessions/Playing/Progress', payload);
  }

  async reportPlaybackStop(payload: JellyfinPlaybackReportBody): Promise<void> {
    await this.post<void>('/Sessions/Playing/Stopped', payload);
  }

  buildSubtitleUrl(deliveryUrl?: string): string | null {
    if (!deliveryUrl) return null;
    return this.withApiKey(this.toAbsoluteUrl(deliveryUrl));
  }

  buildStreamUrl(itemId: string, mediaSource: JellyfinMediaSource, options: BuildStreamOptions = {}): JellyfinStreamInfo {
    const playSessionId = options.playSessionId || `${Date.now()}`;

    if (mediaSource.SupportsDirectPlay || mediaSource.SupportsDirectStream) {
      const streamContainer = (mediaSource.Container || 'mp4').split(',')[0] || 'mp4';
      const directUrl = new URL(`${this.serverUrl}/Videos/${itemId}/stream.${streamContainer}`);
      directUrl.searchParams.set('Static', 'true');
      directUrl.searchParams.set('mediaSourceId', mediaSource.Id);
      directUrl.searchParams.set('deviceId', options.deviceId || DEVICE_ID);
      directUrl.searchParams.set('ApiKey', this.token);
      directUrl.searchParams.set('PlaySessionId', playSessionId);
      if (mediaSource.LiveStreamId) {
        directUrl.searchParams.set('LiveStreamId', mediaSource.LiveStreamId);
      }
      if (options.startTimeTicks && options.startTimeTicks > 0) {
        directUrl.searchParams.set('StartTimeTicks', String(options.startTimeTicks));
      }

      return {
        url: directUrl.toString(),
        mimeType: this.getMimeTypeFromContainer(streamContainer),
        isHls: false,
        playMethod: mediaSource.SupportsDirectPlay ? 'DirectPlay' : 'DirectStream',
        playSessionId,
      };
    }

    if (mediaSource.TranscodingUrl) {
      const transcodingUrl = new URL(this.toAbsoluteUrl(mediaSource.TranscodingUrl));
      transcodingUrl.searchParams.set('ApiKey', this.token);
      if (!transcodingUrl.searchParams.has('PlaySessionId')) {
        transcodingUrl.searchParams.set('PlaySessionId', playSessionId);
      }
      if (options.maxStreamingBitrate) {
        transcodingUrl.searchParams.set('MaxStreamingBitrate', String(options.maxStreamingBitrate));
      }
      if (options.startTimeTicks && options.startTimeTicks > 0) {
        transcodingUrl.searchParams.set('StartTimeTicks', String(options.startTimeTicks));
      }

      const isHls =
        transcodingUrl.pathname.endsWith('.m3u8') || mediaSource.TranscodingSubProtocol?.toLowerCase() === 'hls';

      return {
        url: transcodingUrl.toString(),
        mimeType: isHls ? 'application/x-mpegURL' : this.getMimeTypeFromContainer(mediaSource.TranscodingContainer || 'mp4'),
        isHls,
        playMethod: 'Transcode',
        playSessionId,
      };
    }

    const progressiveUrl = new URL(`${this.serverUrl}/Videos/${itemId}/stream.mp4`);
    progressiveUrl.searchParams.set('mediaSourceId', mediaSource.Id);
    progressiveUrl.searchParams.set('deviceId', options.deviceId || DEVICE_ID);
    progressiveUrl.searchParams.set('ApiKey', this.token);
    progressiveUrl.searchParams.set('PlaySessionId', playSessionId);
    progressiveUrl.searchParams.set('VideoCodec', 'h264');
    progressiveUrl.searchParams.set('AudioCodec', 'aac');
    progressiveUrl.searchParams.set('EnableAutoStreamCopy', 'true');
    if (options.maxStreamingBitrate) {
      progressiveUrl.searchParams.set('MaxStreamingBitrate', String(options.maxStreamingBitrate));
    }
    if (options.startTimeTicks && options.startTimeTicks > 0) {
      progressiveUrl.searchParams.set('StartTimeTicks', String(options.startTimeTicks));
    }

    return {
      url: progressiveUrl.toString(),
      mimeType: 'video/mp4',
      isHls: false,
      playMethod: 'Transcode',
      playSessionId,
    };
  }

  private getMimeTypeFromContainer(container: string): string {
    const normalized = container.toLowerCase();
    if (normalized === 'webm') return 'video/webm';
    if (normalized === 'mkv') return 'video/x-matroska';
    if (normalized === 'ts') return 'video/mp2t';
    return 'video/mp4';
  }
}
