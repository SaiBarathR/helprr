// Builds the DeviceProfile sent with PlaybackInfo: what this browser can play
// directly vs what the server must transcode. Static per-platform base (Safari
// native HLS vs MSE/hls.js) refined by canPlayType / MediaSource.isTypeSupported
// probes. Browser-only.

import type {
  CodecProfile,
  DeviceProfile,
  DirectPlayProfile,
  SubtitleProfile,
  TranscodingProfile,
} from '@/types/jellyfin-playback';

export const DEFAULT_MAX_STREAMING_BITRATE = 120_000_000;

let probeVideo: HTMLVideoElement | null = null;
function videoEl(): HTMLVideoElement {
  if (!probeVideo) probeVideo = document.createElement('video');
  return probeVideo;
}

/** canPlayType "maybe"/"probably" → true. Used for the native <video src> pipeline. */
function canPlayNative(type: string): boolean {
  return videoEl().canPlayType(type) !== '';
}

function canPlayMse(type: string): boolean {
  return typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(type);
}

/** Safari (macOS/iOS) plays HLS natively in <video>; everywhere else transcodes go through hls.js/MSE. */
export function hasNativeHls(): boolean {
  return canPlayNative('application/vnd.apple.mpegurl');
}

/** Probe a codec through whichever pipeline transcoded HLS will actually use. */
function canPlayHls(type: string): boolean {
  return hasNativeHls() ? canPlayNative(type) : canPlayMse(type);
}

const HEVC_TYPES = ['video/mp4; codecs="hvc1.1.6.L120.B0"', 'video/mp4; codecs="hev1.1.6.L120.B0"'];
const AV1_TYPE = 'video/mp4; codecs="av01.0.08M.08"';

export function buildDeviceProfile(
  maxStreamingBitrate: number = DEFAULT_MAX_STREAMING_BITRATE
): DeviceProfile {
  // ── Direct play (native <video src> pipeline) ──────────────────────────────
  const mp4Video = ['h264'];
  if (HEVC_TYPES.some(canPlayNative)) mp4Video.push('hevc');
  if (canPlayNative(AV1_TYPE)) mp4Video.push('av1');
  if (canPlayNative('video/mp4; codecs="vp09.00.40.08"')) mp4Video.push('vp9');

  const mp4Audio = ['aac', 'mp3'];
  if (canPlayNative('audio/mp4; codecs="ac-3"')) mp4Audio.push('ac3');
  if (canPlayNative('audio/mp4; codecs="ec-3"')) mp4Audio.push('eac3');
  if (canPlayNative('audio/mp4; codecs="flac"')) mp4Audio.push('flac');
  if (canPlayNative('audio/mp4; codecs="opus"')) mp4Audio.push('opus');

  const directPlayProfiles: DirectPlayProfile[] = [
    {
      Container: 'mp4,m4v',
      Type: 'Video',
      VideoCodec: mp4Video.join(','),
      AudioCodec: mp4Audio.join(','),
    },
  ];
  if (canPlayNative('video/webm')) {
    const webmVideo = ['vp8'];
    if (canPlayNative('video/webm; codecs="vp9"')) webmVideo.push('vp9');
    if (canPlayNative('video/webm; codecs="av01.0.08M.08"')) webmVideo.push('av1');
    directPlayProfiles.push({
      Container: 'webm',
      Type: 'Video',
      VideoCodec: webmVideo.join(','),
      AudioCodec: 'vorbis,opus',
    });
  }
  // canPlayType lies about mkv ('' even where it plays); Chromium's <video>
  // demuxes Matroska fine, so gate on the same browser sniff jellyfin-web uses.
  // Non-Chromium browsers fall back to DirectStream (remux, video untouched).
  if ('chrome' in window) {
    directPlayProfiles.push({
      Container: 'mkv',
      Type: 'Video',
      VideoCodec: mp4Video.join(','),
      AudioCodec: mp4Audio.join(','),
    });
  }

  directPlayProfiles.push(
    { Container: 'mp3', Type: 'Audio' },
    { Container: 'aac,m4a,m4b', Type: 'Audio' },
    { Container: 'wav', Type: 'Audio' }
  );
  if (canPlayNative('audio/flac')) directPlayProfiles.push({ Container: 'flac', Type: 'Audio' });
  if (canPlayNative('audio/ogg; codecs="vorbis"')) {
    directPlayProfiles.push({ Container: 'ogg,oga', Type: 'Audio' });
  }

  // ── Transcoding (HLS pipeline: native on Safari, hls.js/MSE elsewhere) ─────
  // Server walks these in order: fmp4 first for better codecs, ts h264+aac as
  // the universal floor.
  const hlsVideo = ['h264'];
  if (HEVC_TYPES.some(canPlayHls)) hlsVideo.push('hevc');
  const hlsAudio = ['aac', 'mp3'];
  if (canPlayHls('audio/mp4; codecs="ac-3"')) hlsAudio.push('ac3');
  if (canPlayHls('audio/mp4; codecs="ec-3"')) hlsAudio.push('eac3');

  const transcodingProfiles: TranscodingProfile[] = [
    {
      Container: 'mp4',
      Type: 'Video',
      VideoCodec: hlsVideo.join(','),
      AudioCodec: hlsAudio.join(','),
      Protocol: 'hls',
      Context: 'Streaming',
      MinSegments: 2,
      BreakOnNonKeyFrames: true,
    },
    {
      Container: 'ts',
      Type: 'Video',
      VideoCodec: 'h264',
      AudioCodec: 'aac,mp3',
      Protocol: 'hls',
      Context: 'Streaming',
      MinSegments: 2,
      BreakOnNonKeyFrames: true,
    },
    {
      Container: 'mp3',
      Type: 'Audio',
      AudioCodec: 'mp3',
      Protocol: 'http',
      Context: 'Streaming',
    },
  ];

  // Keep odd encodes (Hi10P anime, exotic levels) off the direct-play path —
  // without these the server assumes anything tagged h264/hevc plays.
  const codecProfiles: CodecProfile[] = [
    {
      Type: 'Video',
      Codec: 'h264',
      Conditions: [
        {
          Condition: 'EqualsAny',
          Property: 'VideoProfile',
          Value: 'high|main|baseline|constrained baseline',
          IsRequired: false,
        },
        { Condition: 'LessThanEqual', Property: 'VideoLevel', Value: '52', IsRequired: false },
      ],
    },
    {
      Type: 'Video',
      Codec: 'hevc',
      Conditions: [
        { Condition: 'EqualsAny', Property: 'VideoProfile', Value: 'main|main 10', IsRequired: false },
      ],
    },
  ];

  const subtitleProfiles: SubtitleProfile[] = [
    { Format: 'vtt', Method: 'External' },
    { Format: 'srt', Method: 'External' },
    { Format: 'subrip', Method: 'External' },
    { Format: 'ass', Method: 'Encode' },
    { Format: 'ssa', Method: 'Encode' },
    { Format: 'pgssub', Method: 'Encode' },
    { Format: 'dvdsub', Method: 'Encode' },
    { Format: 'dvbsub', Method: 'Encode' },
  ];

  return {
    Name: 'Helprr Web',
    MaxStreamingBitrate: maxStreamingBitrate,
    MaxStaticBitrate: 100_000_000,
    MusicStreamingTranscodingBitrate: 384_000,
    DirectPlayProfiles: directPlayProfiles,
    TranscodingProfiles: transcodingProfiles,
    CodecProfiles: codecProfiles,
    SubtitleProfiles: subtitleProfiles,
  };
}
