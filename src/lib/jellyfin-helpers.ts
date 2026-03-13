import type { JellyfinItem, JellyfinTranscodingInfo, JellyfinTaskTrigger } from '@/types/jellyfin';

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

export function getPlayMethodInfo(
  method?: string,
  ti?: JellyfinTranscodingInfo
): { label: string; description: string; color: string } {
  // Remux: reported as Transcode but both video and audio are direct
  if (method === 'Transcode' && ti?.IsVideoDirect && ti?.IsAudioDirect) {
    return {
      label: 'Remuxing',
      description: 'The media is in an incompatible file container but both the video and audio streams are compatible. The media is being repackaged losslessly.',
      color: 'text-blue-400',
    };
  }
  switch (method) {
    case 'Transcode':
      return { label: 'Transcoding', description: 'The server is converting this media in real-time', color: 'text-orange-400' };
    case 'DirectStream':
      return ti
        ? { label: 'Remuxing', description: 'The media is in an incompatible file container but both the video and audio streams are compatible. The media is being repackaged losslessly.', color: 'text-blue-400' }
        : { label: 'Direct Play', description: 'The source file is entirely compatible with this client and the session is receiving the file without modifications.', color: 'text-green-400' };
    case 'DirectPlay':
    default:
      return { label: 'Direct Play', description: 'The source file is entirely compatible with this client and the session is receiving the file without modifications.', color: 'text-green-400' };
  }
}

const TRANSCODE_REASON_MAP: Record<string, string> = {
  ContainerNotSupported: 'Container format is not supported',
  VideoCodecNotSupported: 'Video codec is not supported',
  AudioCodecNotSupported: 'Audio codec is not supported. DTS, Dolby TrueHD, etc. or number of audio channels is not supported by this client.',
  ContainerBitrateExceedsLimit: 'Container bitrate exceeds the limit',
  AudioBitrateNotSupported: 'Audio bitrate is not supported',
  VideoBitrateNotSupported: 'Video bitrate is not supported',
  VideoLevelNotSupported: 'Video level is not supported',
  VideoProfileNotSupported: 'Video profile is not supported',
  AudioChannelsNotSupported: 'Audio channel count is not supported',
  SubtitleCodecNotSupported: 'Subtitle codec requires transcoding',
  VideoRangeTypeNotSupported: 'Video range type (HDR) is not supported',
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

// ─── Scheduled Task Helpers ───

export function ticksToHumanInterval(ticks: number): string {
  const seconds = ticks / 10_000_000;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (days === 7) return '1w';
  return `${Math.round(days)}d`;
}

function ticksToTimeString(ticks: number): string {
  const totalSeconds = ticks / 10_000_000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const h = hours % 12 || 12;
  const ampm = hours < 12 ? 'AM' : 'PM';
  return `${h}:${String(minutes).padStart(2, '0')} ${ampm}`;
}

export function formatTriggerSchedule(triggers: JellyfinTaskTrigger[]): string {
  if (!triggers || triggers.length === 0) return 'Manual';
  // Find the most informative non-startup trigger
  const scheduled = triggers.filter((t) => t.Type !== 'StartupTrigger');
  if (scheduled.length === 0) return 'Startup only';

  const trigger = scheduled[0];
  switch (trigger.Type) {
    case 'IntervalTrigger':
      return `Every ${ticksToHumanInterval(trigger.IntervalTicks!)}`;
    case 'DailyTrigger':
      return `Daily at ${ticksToTimeString(trigger.TimeOfDayTicks!)}`;
    case 'WeeklyTrigger':
      return `${trigger.DayOfWeek} ${ticksToTimeString(trigger.TimeOfDayTicks!)}`;
    default:
      return 'Scheduled';
  }
}

export function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  if (diff < 0) return 'just now';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

export function taskRunDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return '<1s';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  if (minutes < 60) return remaining > 0 ? `${minutes}m ${remaining}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;
  return `${hours}h ${remainingMin}m`;
}
