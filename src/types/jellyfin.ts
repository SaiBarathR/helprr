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

export interface JellyfinProviderIds {
  Imdb?: string;
  Tmdb?: string;
  Tvdb?: string;
  [key: string]: string | undefined;
}

export interface JellyfinUserData {
  PlaybackPositionTicks: number;
  PlayCount: number;
  IsFavorite: boolean;
  Played: boolean;
  PlayedPercentage?: number;
}

export interface JellyfinMediaStream {
  Index: number;
  Type: string;
  Codec?: string;
  Language?: string;
  DisplayTitle?: string;
  Title?: string;
  IsExternal?: boolean;
  IsTextSubtitleStream?: boolean;
  IsDefault?: boolean;
  DeliveryMethod?: string;
  DeliveryUrl?: string;
}

export interface JellyfinMediaSource {
  Id: string;
  Name?: string;
  Container?: string;
  Path?: string;
  Protocol?: string;
  RunTimeTicks?: number;
  Bitrate?: number;
  SupportsDirectPlay: boolean;
  SupportsDirectStream: boolean;
  SupportsTranscoding: boolean;
  StreamUrl?: string;
  TranscodingUrl?: string;
  TranscodingSubProtocol?: string;
  TranscodingContainer?: string;
  LiveStreamId?: string;
  DefaultAudioStreamIndex?: number;
  DefaultSubtitleStreamIndex?: number;
  TranscodeReasons?: string[];
  MediaStreams: JellyfinMediaStream[];
}

export interface JellyfinItem {
  Id: string;
  Name: string;
  Type: string;
  Overview?: string;
  SeriesName?: string;
  SeriesId?: string;
  ParentId?: string;
  SeasonName?: string;
  ProductionYear?: number;
  CommunityRating?: number;
  RunTimeTicks?: number;
  Genres?: string[];
  ImageTags?: Record<string, string>;
  BackdropImageTags?: string[];
  UserData?: JellyfinUserData;
  ProviderIds?: JellyfinProviderIds;
  DateCreated?: string;
  PremiereDate?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  MediaType?: string;
  MediaSources?: JellyfinMediaSource[];
}

export interface JellyfinItemsResponse {
  Items: JellyfinItem[];
  TotalRecordCount: number;
  StartIndex: number;
}

export interface JellyfinPlaybackInfoResponse {
  MediaSources: JellyfinMediaSource[];
  PlaySessionId?: string;
  ErrorCode?: string;
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

export interface JellyfinPlaybackTrackOption {
  index: number;
  label: string;
  language?: string;
  codec?: string;
  isDefault: boolean;
  isExternal?: boolean;
  url?: string;
}

export interface JellyfinPlaybackQualityOption {
  id: string;
  label: string;
  mediaSourceId: string;
  estimatedBitrate?: number;
  supportsDirectPlay: boolean;
  supportsDirectStream: boolean;
  supportsTranscoding: boolean;
}

export interface JellyfinPlaybackReportBody {
  ItemId: string;
  SessionId?: string;
  MediaSourceId?: string;
  AudioStreamIndex?: number;
  SubtitleStreamIndex?: number;
  IsPaused?: boolean;
  IsMuted?: boolean;
  CanSeek?: boolean;
  PositionTicks?: number;
  PlaybackStartTimeTicks?: number;
  VolumeLevel?: number;
  PlayMethod?: 'Transcode' | 'DirectStream' | 'DirectPlay';
  LiveStreamId?: string;
  PlaySessionId?: string;
  Failed?: boolean;
}
