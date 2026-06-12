// Wire types for in-app Jellyfin playback: the DeviceProfile the client declares,
// the PlaybackInfo negotiation response, and the /Sessions/Playing* report bodies.
// Field names mirror the Jellyfin API (PascalCase) — these are not Helprr shapes.

/** Response of GET /api/jellyfin/play/ticket — what the browser needs to talk to Jellyfin directly. */
export interface PlayTicket {
  status: 'ok' | 'needsRelink' | 'notLinked';
  serverUrl?: string;
  userId?: string;
  token?: string;
}

export type PlayMethod = 'DirectPlay' | 'DirectStream' | 'Transcode';

// ── DeviceProfile (sent with PlaybackInfo so the server can negotiate) ───────

export interface DirectPlayProfile {
  Container: string;
  Type: 'Video' | 'Audio' | 'Photo';
  VideoCodec?: string;
  AudioCodec?: string;
}

export interface TranscodingProfile {
  Container: string;
  Type: 'Video' | 'Audio';
  VideoCodec?: string;
  AudioCodec: string;
  Protocol: 'http' | 'hls';
  Context: 'Streaming' | 'Static';
  MaxAudioChannels?: string;
  MinSegments?: number;
  BreakOnNonKeyFrames?: boolean;
}

export interface ProfileCondition {
  Condition: 'Equals' | 'NotEquals' | 'LessThanEqual' | 'GreaterThanEqual' | 'EqualsAny';
  Property: string;
  Value: string;
  IsRequired?: boolean;
}

export interface CodecProfile {
  Type: 'Video' | 'VideoAudio' | 'Audio';
  Codec?: string;
  Conditions: ProfileCondition[];
}

export interface SubtitleProfile {
  Format: string;
  Method: 'External' | 'Embed' | 'Encode' | 'Hls' | 'Drop';
}

export interface DeviceProfile {
  Name?: string;
  MaxStreamingBitrate: number;
  MaxStaticBitrate?: number;
  MusicStreamingTranscodingBitrate?: number;
  DirectPlayProfiles: DirectPlayProfile[];
  TranscodingProfiles: TranscodingProfile[];
  CodecProfiles: CodecProfile[];
  SubtitleProfiles: SubtitleProfile[];
}

// ── POST /Items/{itemId}/PlaybackInfo response ───────────────────────────────

export interface PlaybackMediaStream {
  Index: number;
  Type: 'Video' | 'Audio' | 'Subtitle' | 'EmbeddedImage' | 'Data' | 'Lyric';
  Codec?: string;
  Language?: string;
  DisplayTitle?: string;
  Title?: string;
  IsDefault?: boolean;
  IsForced?: boolean;
  IsExternal?: boolean;
  IsTextSubtitleStream?: boolean;
  DeliveryMethod?: 'Encode' | 'Embed' | 'External' | 'Hls' | 'Drop';
  DeliveryUrl?: string;
  Width?: number;
  Height?: number;
  BitRate?: number;
  Channels?: number;
  SampleRate?: number;
  Profile?: string;
  Level?: number;
  VideoRange?: string;
  AverageFrameRate?: number;
}

export interface MediaSourceInfo {
  Id: string;
  Name?: string;
  Container?: string;
  Size?: number;
  Bitrate?: number;
  RunTimeTicks?: number;
  ETag?: string;
  Protocol?: string;
  SupportsDirectPlay: boolean;
  SupportsDirectStream: boolean;
  SupportsTranscoding: boolean;
  TranscodingUrl?: string;
  TranscodingContainer?: string;
  TranscodingSubProtocol?: string;
  MediaStreams: PlaybackMediaStream[];
  DefaultAudioStreamIndex?: number;
  DefaultSubtitleStreamIndex?: number;
}

export interface PlaybackInfoResponse {
  MediaSources: MediaSourceInfo[];
  PlaySessionId: string;
  ErrorCode?: string;
}

// ── The played item (GET /Items/{id}?Fields=Chapters,Trickplay,MediaSources,MediaStreams) ──

export interface ChapterInfo {
  StartPositionTicks: number;
  Name?: string;
  ImageTag?: string;
}

export interface TrickplayInfo {
  Width: number;
  Height: number;
  TileWidth: number;
  TileHeight: number;
  ThumbnailCount: number;
  Interval: number;
  Bandwidth?: number;
}

/** Minimal episode shape for the next-up autoplay overlay and episode picker. */
export interface EpisodeSummary {
  Id: string;
  Name: string;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  SeriesName?: string;
  SeasonName?: string;
  RunTimeTicks?: number;
  UserData?: { PlayedPercentage?: number; Played?: boolean; PlaybackPositionTicks?: number };
}

export interface PlayableItem {
  Id: string;
  Name: string;
  Type: string;
  MediaType?: string;
  RunTimeTicks?: number;
  ProductionYear?: number;
  SeriesId?: string;
  SeriesName?: string;
  SeasonName?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  Chapters?: ChapterInfo[];
  /** Keyed by MediaSourceId, then by tile width. */
  Trickplay?: Record<string, Record<string, TrickplayInfo>>;
  MediaSources?: MediaSourceInfo[];
  UserData?: { PlaybackPositionTicks?: number; Played?: boolean };
}

// ── POST /Sessions/Playing[/Progress|/Stopped] bodies ────────────────────────

interface PlaybackReportBase {
  ItemId: string;
  MediaSourceId: string;
  PlaySessionId: string;
  PositionTicks: number;
}

export interface PlaybackStartReport extends PlaybackReportBase {
  PlayMethod: PlayMethod;
  CanSeek: boolean;
  IsPaused: boolean;
  IsMuted?: boolean;
  AudioStreamIndex?: number;
  SubtitleStreamIndex?: number;
  MaxStreamingBitrate?: number;
}

export interface PlaybackProgressReport extends PlaybackStartReport {
  EventName?: 'timeupdate' | 'pause' | 'unpause' | 'volumechange';
}

export type PlaybackStopReport = PlaybackReportBase;
