// Negotiation + track/quality switch logic (plan §E), kept out of the React
// layer: the component asks for an ActivePlayback and only deals with attaching
// the URL, the timeline offset, and report payloads. Browser-only.

import type {
  MediaSourceInfo,
  PlaybackMediaStream,
  PlayMethod,
} from '@/types/jellyfin-playback';
import {
  buildDirectStreamUrl,
  buildTranscodeUrl,
  getPlaybackInfo,
  type OkTicket,
} from '@/lib/playback/api';

export const TICKS_PER_SECOND = 10_000_000;

export function ticksToSeconds(ticks: number): number {
  return ticks / TICKS_PER_SECOND;
}

export function secondsToTicks(seconds: number): number {
  return Math.floor(seconds * TICKS_PER_SECOND);
}

export interface NegotiateOptions {
  startTicks?: number;
  mediaSourceId?: string;
  audioStreamIndex?: number;
  /** -1 = explicitly off; undefined = server/user default. */
  subtitleStreamIndex?: number;
  /** null/undefined = no cap (Auto/Direct). */
  maxStreamingBitrate?: number | null;
  /**
   * Disable direct play for switches the server would otherwise ignore (manual
   * audio track choice on a direct-playable file). Bitrate caps and burn-in
   * subtitles disqualify direct play server-side on their own.
   */
  enableDirectPlay?: boolean;
}

export interface ActivePlayback {
  playSessionId: string;
  source: MediaSourceInfo;
  url: string;
  isHls: boolean;
  playMethod: PlayMethod;
  /**
   * Seconds already baked into the stream's timeline. Transcode/remux streams
   * start at the requested StartTimeTicks, so video.currentTime 0 maps to this
   * offset; direct play always starts at 0 and seeks natively.
   */
  baseOffsetSeconds: number;
  audioStreamIndex?: number;
  subtitleStreamIndex: number;
  maxStreamingBitrate: number | null;
}

export class PlaybackNegotiationError extends Error {
  constructor(message: string, readonly code: 'noSource' | 'noCompatibleStream' | string) {
    super(message);
    this.name = 'PlaybackNegotiationError';
  }
}

export async function negotiate(
  ticket: OkTicket,
  itemId: string,
  options: NegotiateOptions = {}
): Promise<ActivePlayback> {
  const startTicks = options.startTicks ?? 0;
  const info = await getPlaybackInfo(ticket, itemId, {
    startTimeTicks: startTicks,
    mediaSourceId: options.mediaSourceId,
    audioStreamIndex: options.audioStreamIndex,
    subtitleStreamIndex: options.subtitleStreamIndex,
    maxStreamingBitrate: options.maxStreamingBitrate ?? undefined,
    enableDirectPlay: options.enableDirectPlay,
  });

  if (info.ErrorCode) {
    throw new PlaybackNegotiationError(`Jellyfin refused playback: ${info.ErrorCode}`, info.ErrorCode);
  }
  const source = options.mediaSourceId
    ? info.MediaSources?.find((s) => s.Id === options.mediaSourceId)
    : info.MediaSources?.[0];
  if (!source) {
    throw new PlaybackNegotiationError('No media source available for this item', 'noSource');
  }

  const base = {
    playSessionId: info.PlaySessionId,
    source,
    audioStreamIndex: options.audioStreamIndex ?? source.DefaultAudioStreamIndex,
    subtitleStreamIndex:
      options.subtitleStreamIndex ?? source.DefaultSubtitleStreamIndex ?? -1,
    maxStreamingBitrate: options.maxStreamingBitrate ?? null,
  };

  if (source.SupportsDirectPlay) {
    return {
      ...base,
      url: buildDirectStreamUrl(ticket, itemId, source),
      isHls: false,
      playMethod: 'DirectPlay',
      baseOffsetSeconds: 0,
    };
  }

  const url = buildTranscodeUrl(ticket, source);
  if (!url) {
    throw new PlaybackNegotiationError(
      'This file cannot be played or transcoded for this browser',
      'noCompatibleStream'
    );
  }
  return {
    ...base,
    url,
    isHls: source.TranscodingSubProtocol === 'hls' || url.includes('.m3u8'),
    playMethod: source.SupportsDirectStream ? 'DirectStream' : 'Transcode',
    baseOffsetSeconds: ticksToSeconds(startTicks),
  };
}

/**
 * Resolve the persisted subtitle-language preference against an item's streams
 * before the first negotiation. 'off' → -1; no pref or no match → undefined
 * (server/user default applies).
 */
export function pickSubtitleIndexForLanguage(
  streams: PlaybackMediaStream[] | undefined,
  language: string | null
): number | undefined {
  if (language === 'off') return -1;
  if (!language || !streams) return undefined;
  const candidates = streams.filter((s) => s.Type === 'Subtitle' && s.Language === language);
  const preferred = candidates.find((s) => s.IsDefault) ?? candidates[0];
  return preferred?.Index;
}
