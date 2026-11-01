export const QUALITIES = ['best', '2160', '1440', '1080', '720', '480'] as const;
export const CODECS = ['compatible', 'av1', 'vp9', 'best'] as const;
export const SPONSORBLOCK_MODES = ['off', 'mark', 'remove'] as const;

export type YoutubeQuality = (typeof QUALITIES)[number];
export type YoutubeCodec = (typeof CODECS)[number];
export type SponsorblockMode = (typeof SPONSORBLOCK_MODES)[number];

const CODEC_FILTERS: Record<YoutubeCodec, string> = {
  compatible: '[vcodec^=avc1]',
  av1: '[vcodec^=av01]',
  // Plain vp9 is the DASH copy with a known size. vp09 is the HLS one, with none.
  vp9: '[vcodec^=vp9]',
  best: '',
};

/**
 * The one place a yt-dlp selector is built, only ever from these fixed choices. If this video
 * lacks the exact choice, it falls back to the nearest, and the Library shows what arrived.
 */
export function formatSelector(quality: string, codec: string): string {
  const height = quality === 'best' || !QUALITIES.includes(quality as YoutubeQuality) ? '' : `[height<=${quality}]`;
  const filter = CODEC_FILTERS[codec as YoutubeCodec] ?? '';
  const exact = codec === 'compatible' ? `bv*${height}${filter}+ba[ext=m4a]` : `bv*${height}${filter}+ba`;
  return `${exact}/bv*${height}+ba/b`;
}

/** Size of what the selector chose, from the metadata. Null when YouTube gives no figures. */
export function selectedBytes(formats: Array<{ filesize?: number | null; filesize_approx?: number | null }> | undefined): number | null {
  if (!formats?.length) return null;
  const sizes = formats.map((format) => format.filesize ?? format.filesize_approx ?? null);
  return sizes.includes(null) ? null : (sizes as number[]).reduce((total, size) => total + size, 0);
}

export interface OfferedFormat {
  height: number;
  codec: 'h264' | 'vp9' | 'av1';
  bytes: number | null;
}

export interface VideoFormats {
  offered: OfferedFormat[];
  audioBytes: number | null;
}

interface RawFormat {
  vcodec?: string | null;
  acodec?: string | null;
  ext?: string | null;
  height?: number | null;
  filesize?: number | null;
  filesize_approx?: number | null;
}

function codecOf(vcodec: string): OfferedFormat['codec'] | null {
  if (vcodec.startsWith('avc1')) return 'h264';
  if (vcodec.startsWith('vp9') || vcodec.startsWith('vp09')) return 'vp9';
  return vcodec.startsWith('av01') ? 'av1' : null;
}

const sizeOf = (format: RawFormat) => format.filesize ?? format.filesize_approx ?? null;

/** What this video really offers, one entry per height and codec, without any signed link. */
export function summarizeFormats(formats: RawFormat[]): VideoFormats {
  const best = new Map<string, OfferedFormat>();
  for (const format of formats) {
    const codec = format.vcodec ? codecOf(format.vcodec) : null;
    if (!codec || !format.height) continue;
    const key = `${format.height}-${codec}`;
    const bytes = sizeOf(format);
    const current = best.get(key);
    if (!current || (bytes ?? 0) > (current.bytes ?? 0)) best.set(key, { height: format.height, codec, bytes });
  }
  const audio = formats.filter((format) => format.vcodec === 'none' && format.ext === 'm4a').map(sizeOf);
  return {
    offered: [...best.values()].sort((a, b) => b.height - a.height),
    audioBytes: audio.reduce<number | null>((largest, bytes) => Math.max(largest ?? 0, bytes ?? 0) || null, null),
  };
}

const CODEC_NAMES: Record<YoutubeCodec, OfferedFormat['codec'] | null> = { compatible: 'h264', av1: 'av1', vp9: 'vp9', best: null };

/** What the selector will land on, so the sheet can say what will really arrive. */
export function pickOffered({ offered }: VideoFormats, quality: string, codec: YoutubeCodec): OfferedFormat | null {
  const limit = quality === 'best' ? Infinity : Number(quality);
  const fitting = offered.filter((format) => format.height <= limit);
  const wanted = CODEC_NAMES[codec];
  return fitting.find((format) => format.codec === wanted) ?? fitting[0] ?? null;
}
