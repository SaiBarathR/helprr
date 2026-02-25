import type { JellyfinItem, JellyfinTranscodingInfo } from '@/types/jellyfin';

export function ticksToMinutes(ticks: number): string {
  const totalMinutes = Math.floor(ticks / 600000000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function ticksToProgress(position: number, runtime: number): number {
  if (!runtime || runtime === 0) return 0;
  return Math.min(100, (position / runtime) * 100);
}

export function getSessionTitle(item: JellyfinItem): string {
  if (item.Type === 'Episode' && item.SeriesName) {
    const s = item.ParentIndexNumber != null ? `S${item.ParentIndexNumber}` : '';
    const e = item.IndexNumber != null ? `E${item.IndexNumber}` : '';
    return `${item.SeriesName} ${s}${e}`;
  }
  return item.Name;
}

export function formatDurationSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatBitrate(bps: number): string {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} Kbps`;
  return `${bps} bps`;
}

export function formatResolution(w: number, h: number): string {
  if (h >= 2160) return '4K';
  if (h >= 1440) return '1440p';
  if (h >= 1080) return '1080p';
  if (h >= 720) return '720p';
  if (h >= 480) return '480p';
  return `${w}×${h}`;
}

export function getPlayMethodInfo(method?: string): { label: string; description: string; color: string } {
  switch (method) {
    case 'Transcode':
      return { label: 'Transcoding', description: 'The server is converting this media in real-time', color: 'text-orange-400' };
    case 'DirectStream':
      return { label: 'Direct Streaming', description: 'The container is being remuxed without re-encoding', color: 'text-blue-400' };
    case 'DirectPlay':
    default:
      return { label: 'Direct Playing', description: 'The file is being sent directly without modification', color: 'text-green-400' };
  }
}

const TRANSCODE_REASON_MAP: Record<string, string> = {
  ContainerNotSupported: 'Container format is not supported',
  VideoCodecNotSupported: 'Video codec is not supported',
  AudioCodecNotSupported: 'Audio codec is not supported',
  ContainerBitrateExceedsLimit: 'Container bitrate exceeds the limit',
  AudioBitrateNotSupported: 'Audio bitrate is not supported',
  VideoBitrateNotSupported: 'Video bitrate is not supported',
  VideoLevelNotSupported: 'Video level is not supported',
  VideoProfileNotSupported: 'Video profile is not supported',
  AudioChannelsNotSupported: 'Audio channel count is not supported',
  SubtitleCodecNotSupported: 'Subtitle codec requires transcoding',
  VideoRangeTypeNotSupported: 'Video range type (HDR/SDR) is not supported',
  AudioProfileNotSupported: 'Audio profile is not supported',
  RefFramesNotSupported: 'Reference frame count is not supported',
  VideoResolutionNotSupported: 'Video resolution is not supported',
  VideoFramerateNotSupported: 'Video frame rate is not supported',
  AudioSampleRateNotSupported: 'Audio sample rate is not supported',
  DirectPlayError: 'A direct play error occurred',
};

export function formatTranscodeReason(reason: string): string {
  if (TRANSCODE_REASON_MAP[reason]) return TRANSCODE_REASON_MAP[reason];
  return reason.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

export function getTranscodeOutputSummary(ti: JellyfinTranscodingInfo): string {
  const parts: string[] = [];
  if (ti.Bitrate) parts.push(formatBitrate(ti.Bitrate));
  if (ti.Container) parts.push(ti.Container.toUpperCase());
  if (ti.VideoCodec) parts.push(ti.VideoCodec.toUpperCase());
  if (ti.AudioCodec) parts.push(ti.AudioCodec.toUpperCase());
  return parts.join(' ');
}
