import type {
  JellyfinItem,
  JellyfinLibrary,
  JellyfinMediaSource,
} from '@/types/jellyfin';

export const TICKS_PER_SECOND = 10_000_000;
export const TICKS_PER_MS = 10_000;

export type JellyfinPlayMethod = 'DirectPlay' | 'DirectStream' | 'Transcode';

export interface JellyfinDeviceProfileCondition {
  Condition: string;
  Property: string;
  Value: string;
  IsRequired?: boolean;
}

export interface JellyfinDirectPlayProfile {
  Container: string;
  Type: 'Audio' | 'Video' | 'Photo';
  VideoCodec?: string;
  AudioCodec?: string;
}

export interface JellyfinTranscodingProfile {
  Container: string;
  Type: 'Audio' | 'Video';
  AudioCodec: string;
  VideoCodec?: string;
  Context: 'Streaming' | 'Static';
  Protocol: 'http' | 'hls';
  MaxAudioChannels?: string;
  MinSegments?: string;
  BreakOnNonKeyFrames?: boolean;
  EnableAudioVbrEncoding?: boolean;
  SegmentLength?: number;
  ApplyConditions?: JellyfinDeviceProfileCondition[];
}

export interface JellyfinCodecProfile {
  Type: 'Audio' | 'Video' | 'VideoAudio';
  Codec?: string;
  Conditions: JellyfinDeviceProfileCondition[];
}

export interface JellyfinSubtitleProfile {
  Format: string;
  Method: 'Encode' | 'Embed' | 'External' | 'Hls';
}

export interface JellyfinDeviceProfile {
  MaxStreamingBitrate: number;
  MaxStaticBitrate: number;
  MusicStreamingTranscodingBitrate: number;
  DirectPlayProfiles: JellyfinDirectPlayProfile[];
  TranscodingProfiles: JellyfinTranscodingProfile[];
  ContainerProfiles: Array<{
    Type: string;
    Conditions: JellyfinDeviceProfileCondition[];
  }>;
  CodecProfiles: JellyfinCodecProfile[];
  SubtitleProfiles: JellyfinSubtitleProfile[];
  ResponseProfiles: Array<{
    Type: string;
    Container: string;
    MimeType: string;
  }>;
}

export interface PlaybackInfoRequest {
  itemId: string;
  deviceId: string;
  deviceName?: string;
  startTimeTicks?: number;
  maxStreamingBitrate?: number;
  audioStreamIndex?: number | null;
  subtitleStreamIndex?: number | null;
  mediaSourceId?: string;
  liveStreamId?: string;
  enableDirectPlay?: boolean;
  enableDirectStream?: boolean;
  allowVideoStreamCopy?: boolean;
  allowAudioStreamCopy?: boolean;
  alwaysBurnInSubtitleWhenTranscoding?: boolean;
  isPlayback?: boolean;
  deviceProfile: JellyfinDeviceProfile;
}

export interface PlaybackInfoResponse {
  PlaySessionId?: string;
  ErrorCode?: string;
  MediaSources: JellyfinMediaSource[];
}

export interface HelprrStreamInfo {
  item: JellyfinItem;
  mediaSource: JellyfinMediaSource;
  playMethod: JellyfinPlayMethod;
  playSessionId: string;
  mediaUrl: string;
  mimeType: string;
  startTimeTicks: number;
  transcodingOffsetTicks: number;
  liveStreamId?: string;
  subtitleTracks: HelprrSubtitleTrack[];
}

export interface HelprrSubtitleTrack {
  index: number;
  url: string;
  language: string;
  displayTitle: string;
  format: string;
  isDefault: boolean;
  isForced: boolean;
  isHearingImpaired: boolean;
  deliveryMethod: string;
}

export interface PlaybackProgressPayload {
  event: 'playing' | 'progress' | 'stopped';
  deviceId: string;
  deviceName?: string;
  itemId: string;
  mediaSourceId?: string;
  playSessionId?: string;
  positionTicks?: number;
  isPaused?: boolean;
  isMuted?: boolean;
  volumeLevel?: number;
  playbackRate?: number;
  playMethod?: JellyfinPlayMethod;
  audioStreamIndex?: number | null;
  subtitleStreamIndex?: number | null;
  liveStreamId?: string;
  repeatMode?: 'RepeatNone' | 'RepeatAll' | 'RepeatOne';
  shuffleMode?: 'Sorted' | 'Shuffle';
  canSeek?: boolean;
  playbackStartTimeTicks?: number;
  maxStreamingBitrate?: number;
}

export interface CatalogHomeResponse {
  linked: boolean;
  views: JellyfinLibrary[];
  resume: JellyfinItem[];
  nextUp: JellyfinItem[];
  latest: Array<{
    libraryId: string;
    libraryName: string;
    collectionType: string;
    items: JellyfinItem[];
  }>;
  favorites: JellyfinItem[];
  upcoming: JellyfinItem[];
  suggestions: Array<{ title: string; items: JellyfinItem[] }>;
}

export interface CatalogItemDetailResponse {
  linked: boolean;
  item: JellyfinItem | null;
  seasons?: JellyfinItem[];
  episodes?: JellyfinItem[];
  similar?: JellyfinItem[];
  specialFeatures?: JellyfinItem[];
  instantMix?: JellyfinItem[];
  segments?: MediaSegment[];
  themeMedia?: {
    themeSongs: JellyfinItem[];
    themeVideos: JellyfinItem[];
    soundtrackSongs: JellyfinItem[];
  };
  children?: JellyfinItem[];
  filmography?: JellyfinItem[];
  localTrailers?: JellyfinItem[];
}

export interface MediaSegment {
  Id?: string;
  ItemId?: string;
  Type?: string;
  StartTicks?: number;
  EndTicks?: number;
}

export interface CatalogItemsResponse {
  linked: boolean;
  items: JellyfinItem[];
  total: number;
  startIndex: number;
}

export interface CatalogFiltersResponse {
  linked: boolean;
  genres: string[];
  years: number[];
  officialRatings: string[];
  tags: string[];
}

export interface LiveTvResponse {
  linked: boolean;
  channels: JellyfinItem[];
  programs: JellyfinItem[];
  recordings: JellyfinItem[];
}

export interface HelprrLyricLine {
  text: string;
  startSeconds: number | null;
}

export interface LyricsResponse {
  linked: boolean;
  lyrics: unknown;
}

export const CATALOG_ITEM_FIELDS = [
  'Overview',
  'Genres',
  'CommunityRating',
  'CriticRating',
  'OfficialRating',
  'PremiereDate',
  'ProductionYear',
  'Status',
  'EndDate',
  'RunTimeTicks',
  'CumulativeRunTimeTicks',
  'Studios',
  'People',
  'ProviderIds',
  'ParentId',
  'RecursiveItemCount',
  'ChildCount',
  'ImageTags',
  'BackdropImageTags',
  'PrimaryImageAspectRatio',
  'MediaStreams',
  'Chapters',
  'Trickplay',
  'Taglines',
  'RemoteTrailers',
  'SeriesName',
  'SeriesId',
  'SeasonName',
  'SeasonId',
  'IndexNumber',
  'ParentIndexNumber',
  'MediaType',
  'Container',
  'Width',
  'Height',
  'CanDownload',
  'SpecialFeatureCount',
  'LocalTrailerCount',
  'OriginalTitle',
  'SortName',
  'IsFolder',
  'AlbumArtist',
  'Album',
  'Artists',
  'NormalizationGain',
  'ProductionLocations',
  'DateCreated',
].join(',');

export const CATALOG_LIST_FIELDS = [
  'Overview',
  'Genres',
  'CommunityRating',
  'OfficialRating',
  'PremiereDate',
  'ProductionYear',
  'RunTimeTicks',
  'ImageTags',
  'BackdropImageTags',
  'PrimaryImageAspectRatio',
  'RecursiveItemCount',
  'ChildCount',
  'SeriesName',
  'SeriesId',
  'SeasonName',
  'SeasonId',
  'IndexNumber',
  'ParentIndexNumber',
  'MediaType',
  'Container',
  'ParentId',
  'AlbumArtist',
  'Album',
  'Artists',
  'Status',
  'EndDate',
].join(',');
