export interface JellyfinAuthResponse {
  User: {
    Name: string;
    Id: string;
    ServerId: string;
  };
  AccessToken: string;
  ServerId: string;
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
  IsVideoDirect: boolean;
  IsAudioDirect: boolean;
  TranscodeReasons?: string[];
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
