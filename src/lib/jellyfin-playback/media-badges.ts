import type { JellyfinMediaStream } from '@/types/jellyfin';

/**
 * The short capability badges shown beside a title's year and runtime.
 *
 * Everything here comes from the streams Jellyfin already reports, so a badge
 * appears only when the file genuinely carries the feature. Absent fields mean
 * "not known", never "not present": an unscanned file should read as plain
 * rather than be labelled wrongly.
 */
export interface MediaBadges {
  /** `4K`, `HD`, or null for standard definition, which is not worth a badge. */
  resolution: '4K' | 'HD' | null;
  /** `Dolby Vision`, `HDR10+`, `HDR10`, `HLG` or `HDR`; null when SDR. */
  dynamicRange: string | null;
  /** `Atmos` or `DTS:X` when the track is spatial, else `7.1`/`5.1`. */
  audio: string | null;
  /** Whether any subtitle track exists. */
  subtitles: boolean;
}

/**
 * Resolution from width first, height second.
 *
 * Height alone is wrong for anything but 16:9. A scope-ratio 4K film is
 * 3840x1600, whose height is below even a 1080p frame's, and this library
 * already holds 1040- and 1074-high transfers of 1080p masters.
 */
function resolutionOf(video: JellyfinMediaStream | undefined): MediaBadges['resolution'] {
  const width = video?.Width ?? 0;
  const height = video?.Height ?? 0;
  if (width >= 3000 || height >= 2000) return '4K';
  if (width >= 1200 || height >= 700) return 'HD';
  return null;
}

/**
 * Dolby Vision wins over the HDR10 layer it is usually carried with.
 *
 * Jellyfin reports the combinations as one string — `DOVIWithHDR10`,
 * `DOVIWithHLG`, `DOVIWithSDR` — so these are substring tests rather than
 * equality, and `HDR10Plus` has to be ruled in before plain `HDR10`.
 */
function dynamicRangeOf(video: JellyfinMediaStream | undefined): string | null {
  const type = (video?.VideoRangeType ?? '').toUpperCase();
  if (type.includes('DOVI')) return 'Dolby Vision';
  if (type.includes('HDR10PLUS')) return 'HDR10+';
  if (type.includes('HDR10')) return 'HDR10';
  if (type.includes('HLG')) return 'HLG';
  if (type && type !== 'SDR' && type !== 'UNKNOWN') return 'HDR';
  // Older scans fill VideoRange but not VideoRangeType.
  return (video?.VideoRange ?? '').toUpperCase() === 'HDR' ? 'HDR' : null;
}

/** `DolbyAtmos` / `DTSX`, as Jellyfin spells them. */
function spatialLabel(format: string | undefined): string | null {
  const value = (format ?? '').toUpperCase();
  if (value.includes('ATMOS')) return 'Atmos';
  if (value.includes('DTSX') || value.includes('DTS:X')) return 'DTS:X';
  return null;
}

/**
 * The best audio the file offers, not the track currently selected.
 *
 * A badge row describes the title, so a stereo commentary track alongside a
 * 5.1 mix must not talk the title down. Spatial formats outrank channel counts
 * because Atmos already implies a surround bed.
 */
function audioOf(audio: JellyfinMediaStream[]): string | null {
  for (const stream of audio) {
    const spatial = spatialLabel(stream.AudioSpatialFormat);
    if (spatial) return spatial;
  }
  const channels = audio.reduce((best, stream) => {
    // ChannelLayout is the label to trust when present: `Channels` counts 6 for
    // both `5.1` and `5.1(side)`, and 8 for `7.1`.
    const layout = (stream.ChannelLayout ?? '').toLowerCase();
    if (layout.startsWith('7.1')) return Math.max(best, 8);
    if (layout.startsWith('5.1')) return Math.max(best, 6);
    return Math.max(best, stream.Channels ?? 0);
  }, 0);
  if (channels >= 8) return '7.1';
  if (channels >= 6) return '5.1';
  return null;
}

/** Derive the badge set from a title's media streams. */
export function mediaBadges(streams: JellyfinMediaStream[]): MediaBadges {
  const video = streams.find((stream) => stream.Type === 'Video');
  const audio = streams.filter((stream) => stream.Type === 'Audio');
  return {
    resolution: resolutionOf(video),
    dynamicRange: dynamicRangeOf(video),
    audio: audioOf(audio),
    subtitles: streams.some((stream) => stream.Type === 'Subtitle'),
  };
}
