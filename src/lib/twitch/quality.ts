export interface YtDlpFormat {
  format_id: string;
  height?: number | null;
  fps?: number | null;
  vcodec?: string | null;
  format_note?: string | null;
  ext?: string | null;
}

const QUALITY_PATTERN = /^(\d{3,4})p(\d{2})?$/;
const AUDIO_ONLY = 'audio_only';

// GB per hour measured on real VODs on 2026-10-29.
const GB_PER_HOUR: Record<string, number> = {
  '1440p60': 4.07,
  '1080p60': 3.46,
  '1080p': 3.46,
  '720p60': 1.46,
  '720p': 1.46,
  '480p': 0.6,
  '360p': 0.29,
  '160p': 0.11,
  [AUDIO_ONLY]: 0.094,
};

export function estimateSizeBytes(quality: string, durationSeconds: number): number {
  const rate = GB_PER_HOUR[quality] ?? GB_PER_HOUR['1080p60'];
  return Math.ceil(rate * (durationSeconds / 3600) * 1024 ** 3);
}

function rank(height: number, fps: number): number {
  return height * 1000 + fps;
}

function isVideoFormat(format: YtDlpFormat): boolean {
  return Boolean(format.height)
    && format.vcodec !== 'none'
    && format.ext !== 'mhtml'
    && !/storyboard/i.test(format.format_note ?? '')
    && !/^sb\d/.test(format.format_id);
}

/** The wanted quality, or the best one below it, or failing that the lowest there is. */
export function pickFormat(formats: readonly YtDlpFormat[], wanted: string): string | null {
  if (wanted === AUDIO_ONLY) {
    return formats.find((format) => format.format_id.startsWith('audio'))?.format_id ?? null;
  }
  const videos = formats.filter(isVideoFormat)
    .map((format) => ({ id: format.format_id, rank: rank(format.height!, Math.round(format.fps ?? 30)) }))
    .sort((a, b) => b.rank - a.rank);
  if (videos.length === 0) return null;

  const match = QUALITY_PATTERN.exec(wanted);
  if (!match) return videos[0].id;
  const limit = rank(Number(match[1]), Number(match[2] ?? 30));
  return (videos.find((video) => video.rank <= limit) ?? videos[videos.length - 1]).id;
}
