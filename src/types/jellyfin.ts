export interface JellyfinAuthResponse {
  User: {
    Name: string;
    Id: string;
    ServerId: string;
  };
  AccessToken: string;
  ServerId: string;
}

export interface JellyfinAuthKey {
  AccessToken?: string | null;
  UserId?: string;
}

export interface JellyfinSystemInfo {
  ServerName: string;
  Version: string;
  Id: string;
  OperatingSystem?: string;
  HasPendingRestart?: boolean;
  HasUpdateAvailable?: boolean;
}

export interface JellyfinLibrary {
  Id: string;
  Name: string;
  CollectionType?: string;
  ImageTags?: Record<string, string>;
  ChildCount?: number;
}

export interface JellyfinUserData {
  PlaybackPositionTicks: number;
  PlayCount: number;
  IsFavorite: boolean;
  Played: boolean;
  PlayedPercentage?: number;
}

export interface JellyfinMediaStream {
  Codec?: string;
  BitRate?: number;
  Width?: number;
  Height?: number;
  AverageFrameRate?: number;
  Type: 'Video' | 'Audio' | 'Subtitle' | 'EmbeddedImage';
  ChannelLayout?: string;
  Channels?: number;
  Language?: string;
  DisplayTitle?: string;
  IsDefault?: boolean;
  Profile?: string;
  VideoRange?: string;
  BitDepth?: number;
}

export interface JellyfinItem {
  Id: string;
  Name: string;
  Type: string;
  Overview?: string;
  SeriesName?: string;
  SeriesId?: string;
  SeasonName?: string;
  ProductionYear?: number;
  CommunityRating?: number;
  RunTimeTicks?: number;
  Genres?: string[];
  ImageTags?: Record<string, string>;
  BackdropImageTags?: string[];
  UserData?: JellyfinUserData;
  DateCreated?: string;
  PremiereDate?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  MediaType?: string;
  MediaStreams?: JellyfinMediaStream[];
}

export interface JellyfinItemsResponse {
  Items: JellyfinItem[];
  TotalRecordCount: number;
  StartIndex: number;
}

export interface JellyfinPlayState {
  PositionTicks: number;
  CanSeek: boolean;
  IsPaused: boolean;
  IsMuted: boolean;
  PlayMethod?: string;
}

export interface JellyfinTranscodingInfo {
  AudioCodec?: string;
  VideoCodec?: string;
  Container?: string;
  HardwareAccelerationType?: string;
  IsVideoDirect: boolean;
  IsAudioDirect: boolean;
  TranscodeReasons?: string[];
  Bitrate?: number;
  Width?: number;
  Height?: number;
  AudioChannels?: number;
  Framerate?: number;
}

export interface JellyfinSession {
  Id: string;
  UserName: string;
  UserId?: string;
  Client: string;
  DeviceName: string;
  DeviceId?: string;
  ApplicationVersion?: string;
  NowPlayingItem?: JellyfinItem;
  PlayState?: JellyfinPlayState;
  TranscodingInfo?: JellyfinTranscodingInfo;
  LastActivityDate?: string;
}

export interface JellyfinItemCounts {
  MovieCount: number;
  SeriesCount: number;
  EpisodeCount: number;
  ArtistCount?: number;
  AlbumCount?: number;
  SongCount?: number;
  BookCount?: number;
}

export interface JellyfinSearchHint {
  Id: string;
  Name: string;
  Type: string;
  ProductionYear?: number;
  PrimaryImageTag?: string;
  SeriesName?: string;
}

export interface JellyfinSearchResult {
  SearchHints: JellyfinSearchHint[];
  TotalRecordCount: number;
}

export interface JellyfinActivityEntry {
  Id: number;
  Name: string;
  Overview?: string;
  Type: string;
  Date: string;
  UserId?: string;
  Severity?: string;
  ItemId?: string;
}

export interface JellyfinActivityResponse {
  Items: JellyfinActivityEntry[];
  TotalRecordCount: number;
}

// Native Jellyfin API types
export interface JellyfinUser {
  Id: string;
  Name: string;
  PrimaryImageTag?: string;
  LastLoginDate?: string;
  LastActivityDate?: string;
  Policy?: { IsAdministrator?: boolean; IsHidden?: boolean; IsDisabled?: boolean };
}

export interface JellyfinScheduledTask {
  Id: string;
  Name: string;
  Description?: string;
  Category?: string;
  State: 'Idle' | 'Running' | 'Cancelling';
  CurrentProgressPercentage?: number;
  LastExecutionResult?: { EndTimeUtc?: string; Status?: string };
}

// Playback Reporting Plugin types
export interface PlaybackUserActivity {
  user_id: string;
  user_name: string;
  has_image: boolean;
  latest_date: string;
  last_seen: string;
  item_name: string;
  client_name: string;
  total_count: number;
  total_time: number;
  total_play_time: string;
}

export interface PlayActivityUser {
  user_id: string;
  user_name: string;
  user_usage: Record<string, number>;
}

export interface PlaybackActivityItem {
  Time: string;
  Id: string;
  Name: string;
  Type: string;
  Client: string;
  Method: string;
  Device: string;
  Duration: number;
  RowId: number;
}

export interface PlaybackBreakdownEntry {
  label: string;
  count: number;
  time: number;
}

export interface PlaybackDailyData {
  [date: string]: number;
}

/** Row from submit_custom_query against PlaybackActivity table */
export interface CustomHistoryItem {
  RowId: number;
  DateCreated: string;
  UserId: string;
  ItemId: string;
  ItemType: string;
  ItemName: string;
  PlaybackMethod: string;
  ClientName: string;
  DeviceName: string;
  PlayDuration: number;
}
