import type { JellyfinItem, JellyfinMediaSource, JellyfinMediaStream } from '@/types/jellyfin';
import type {
  HelprrStreamInfo,
  HelprrSubtitleTrack,
  JellyfinPlayMethod,
  PlaybackInfoResponse,
} from '@/types/jellyfin-streaming';
import { stripSensitiveQuery } from '@/lib/jellyfin-playback/media-path';

function proxyUrl(jellyfinPathAndQuery: string): string {
  const [pathPart, queryPart] = jellyfinPathAndQuery.split('?');
  const path = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
  const params = stripSensitiveQuery(new URLSearchParams(queryPart ?? ''));
  const qs = params.toString();
  return qs ? `/api/jellyfin/media${path}?${qs}` : `/api/jellyfin/media${path}`;
}

function mimeFor(type: 'Video' | 'Audio', container: string): string {
  const c = container.toLowerCase();
  if (type === 'Audio') {
    if (c === 'mp3') return 'audio/mpeg';
    if (c === 'aac' || c === 'm4a') return 'audio/mp4';
    if (c === 'flac') return 'audio/flac';
    if (c === 'opus' || c === 'ogg') return 'audio/ogg';
    if (c === 'wav') return 'audio/wav';
    return `audio/${c}`;
  }
  if (c === 'mp4' || c === 'm4v' || c === 'mov') return 'video/mp4';
  if (c === 'webm') return 'video/webm';
  if (c === 'mkv') return 'video/x-matroska';
  return `video/${c}`;
}

function playSessionIdFromUrl(url: string): string {
  try {
    const parsed = new URL(url, 'http://jellyfin.local');
    return parsed.searchParams.get('PlaySessionId')
      ?? parsed.searchParams.get('playSessionId')
      ?? '';
  } catch {
    return '';
  }
}

function subtitleTracks(source: JellyfinMediaSource): HelprrSubtitleTrack[] {
  const streams = source.MediaStreams ?? [];
  const defaultIndex = source.DefaultSubtitleStreamIndex ?? -1;
  return streams
    .filter((stream): stream is JellyfinMediaStream & { Type: 'Subtitle' } => stream.Type === 'Subtitle')
    .map((stream) => ({
      index: stream.Index ?? -1,
      url: stream.DeliveryUrl ? proxyUrl(stream.DeliveryUrl) : '',
      language: stream.Language || 'und',
      displayTitle: stream.DisplayTitle || stream.Title || stream.Language || `Track ${stream.Index}`,
      format: (stream.Codec || '').toLowerCase(),
      isDefault: stream.Index === defaultIndex,
      isForced: Boolean(stream.IsForced),
      isHearingImpaired: Boolean(stream.IsHearingImpaired),
      deliveryMethod: stream.DeliveryMethod || 'External',
    }));
}

export function pickMediaSource(sources: JellyfinMediaSource[]): JellyfinMediaSource | null {
  if (sources.length === 0) return null;
  return sources.find((source) => source.SupportsDirectPlay)
    ?? sources.find((source) => source.SupportsDirectStream)
    ?? sources.find((source) => source.SupportsTranscoding)
    ?? sources[0];
}

export function buildHelprrStreamInfo(input: {
  item: JellyfinItem;
  playback: PlaybackInfoResponse;
  mediaSourceId?: string;
  startTimeTicks?: number;
}): HelprrStreamInfo | { error: string } {
  if (input.playback.ErrorCode) {
    return { error: input.playback.ErrorCode };
  }
  const sources = input.playback.MediaSources ?? [];
  const source = input.mediaSourceId
    ? sources.find((candidate) => candidate.Id === input.mediaSourceId) ?? pickMediaSource(sources)
    : pickMediaSource(sources);
  if (!source) return { error: 'NoCompatibleStream' };

  const type = input.item.MediaType === 'Audio' ? 'Audio' : 'Video';
  const container = (source.Container || '').toLowerCase();
  const startTimeTicks = input.startTimeTicks ?? 0;
  let playMethod: JellyfinPlayMethod = 'Transcode';
  let mediaUrl = '';
  let mimeType = mimeFor(type, container);
  let transcodingOffsetTicks = 0;

  if ((source.SupportsDirectPlay || source.SupportsDirectStream) && source.DirectStreamUrl) {
    mediaUrl = proxyUrl(source.DirectStreamUrl);
    playMethod = source.SupportsDirectPlay ? 'DirectPlay' : 'DirectStream';
  } else if (source.SupportsDirectPlay || source.SupportsDirectStream) {
    const prefix = type === 'Video' ? 'Videos' : 'Audio';
    const params = new URLSearchParams({
      Static: 'true',
      mediaSourceId: source.Id,
      MediaSourceId: source.Id,
    });
    if (source.ETag) params.set('Tag', source.ETag);
    if (source.LiveStreamId) params.set('LiveStreamId', source.LiveStreamId);
    if (input.playback.PlaySessionId) params.set('PlaySessionId', input.playback.PlaySessionId);
    mediaUrl = `/api/jellyfin/media/${prefix}/${input.item.Id}/stream.${container || 'mp4'}?${params.toString()}`;
    playMethod = source.SupportsDirectPlay ? 'DirectPlay' : 'DirectStream';
  } else if (source.SupportsTranscoding && source.TranscodingUrl) {
    mediaUrl = proxyUrl(source.TranscodingUrl);
    playMethod = 'Transcode';
    if (source.TranscodingSubProtocol === 'hls') {
      mimeType = 'application/x-mpegURL';
    } else {
      mimeType = mimeFor(type, source.TranscodingContainer || container);
      if (!mediaUrl.toLowerCase().includes('copytimestamps=true')) {
        transcodingOffsetTicks = startTimeTicks;
      }
    }
  } else {
    return { error: 'NoCompatibleStream' };
  }

  const playSessionId = input.playback.PlaySessionId
    || playSessionIdFromUrl(source.TranscodingUrl || '')
    || '';

  return {
    item: input.item,
    mediaSource: {
      ...source,
      MediaStreams: source.MediaStreams?.map((stream) => (
        stream.DeliveryUrl
          ? { ...stream, DeliveryUrl: proxyUrl(stream.DeliveryUrl) }
          : stream
      )),
      MediaAttachments: source.MediaAttachments?.map((attachment) => (
        attachment.DeliveryUrl
          ? { ...attachment, DeliveryUrl: proxyUrl(attachment.DeliveryUrl) }
          : attachment
      )),
    },
    playMethod,
    playSessionId,
    mediaUrl,
    mimeType,
    startTimeTicks,
    transcodingOffsetTicks,
    liveStreamId: source.LiveStreamId,
    subtitleTracks: subtitleTracks(source),
  };
}
