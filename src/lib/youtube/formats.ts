export const QUALITIES = ['best', '2160', '1440', '1080', '720', '480'] as const;
export const CODECS = ['compatible', 'av1', 'vp9', 'best'] as const;
export const SPONSORBLOCK_MODES = ['off', 'mark', 'remove'] as const;

export type YoutubeQuality = (typeof QUALITIES)[number];
export type YoutubeCodec = (typeof CODECS)[number];
export type SponsorblockMode = (typeof SPONSORBLOCK_MODES)[number];

export interface OfferedFormat {
  /** yt-dlp's name for this copy. Never a link. */
  id: string;
  /** YouTube's name for it, which pixels alone do not give: MKBHD's 4K is 3840×1920. */
  quality: number;
  width: number;
  height: number;
  fps: number;
  codec: 'h264' | 'vp9' | 'av1';
  hdr: boolean;
  bytes: number | null;
  /** Already has its sound, so nothing is merged in. */
  muxed: boolean;
}

export interface OfferedAudio {
  id: string;
  codec: 'aac' | 'opus';
  bytes: number | null;
}

export interface VideoFormats {
  offered: OfferedFormat[];
  audio: OfferedAudio[];
}

/** One exact download: the sheet shows it, and the worker fetches the same copies. */
export interface PickedDownload {
  video: OfferedFormat;
  audio: OfferedAudio | null;
  /** Null when YouTube gives no size. */
  bytes: number | null;
  selector: string;
}

interface RawFormat {
  format_id?: string | null;
  vcodec?: string | null;
  acodec?: string | null;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  format_note?: string | null;
  dynamic_range?: string | null;
  language_preference?: number | null;
  filesize?: number | null;
  filesize_approx?: number | null;
}

const FRAMES = [[256, 144], [426, 240], [640, 360], [854, 480], [1280, 720], [1920, 1080], [2560, 1440], [3840, 2160], [7680, 4320]] as const;

/** The smallest standard frame a picture fits, upright or not. Cinema widths run a little over: 4096×2160 is 4K. */
export function qualityOf(width: number, height: number): number {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  return FRAMES.find(([frameLong, frameShort]) => long <= frameLong * 1.1 && short <= frameShort)?.[1] ?? 4320;
}

export function qualityLabel(quality: number): string {
  if (quality >= 4320) return '8K';
  return quality === 2160 ? '4K' : `${quality}p`;
}

const CODEC_ORDER: Record<YoutubeCodec, OfferedFormat['codec'][]> = {
  compatible: ['h264', 'vp9', 'av1'],
  vp9: ['vp9', 'av1', 'h264'],
  av1: ['av1', 'vp9', 'h264'],
  best: ['av1', 'vp9', 'h264'],
};

function videoCodecOf(vcodec: string): OfferedFormat['codec'] | null {
  if (vcodec.startsWith('avc1')) return 'h264';
  if (vcodec.startsWith('vp9') || vcodec.startsWith('vp09')) return 'vp9';
  return vcodec.startsWith('av01') ? 'av1' : null;
}

function audioCodecOf(acodec: string): OfferedAudio['codec'] | null {
  if (acodec.startsWith('mp4a')) return 'aac';
  return acodec === 'opus' ? 'opus' : null;
}

const sizeOf = (format: RawFormat) => format.filesize ?? format.filesize_approx ?? null;

/** Between two copies of the same thing: one that needs merging, a known size, smoother, then larger. */
function isBetter(next: OfferedFormat, current: OfferedFormat): boolean {
  const order = [
    Number(current.muxed) - Number(next.muxed),
    Number(next.bytes !== null) - Number(current.bytes !== null),
    next.fps - current.fps,
    (next.bytes ?? 0) - (current.bytes ?? 0),
  ];
  return (order.find((difference) => difference !== 0) ?? 0) > 0;
}

function toOffered(format: RawFormat): OfferedFormat | null {
  const codec = format.vcodec ? videoCodecOf(format.vcodec) : null;
  if (!codec || !format.format_id || !format.width || !format.height) return null;
  const named = /^(\d{3,4})p/.exec(format.format_note ?? '');
  return {
    id: format.format_id,
    quality: named ? Number(named[1]) : qualityOf(format.width, format.height),
    width: format.width,
    height: format.height,
    fps: Math.round(format.fps ?? 0),
    codec,
    hdr: Boolean(format.dynamic_range) && format.dynamic_range !== 'SDR',
    bytes: sizeOf(format),
    muxed: Boolean(format.acodec) && format.acodec !== 'none',
  };
}

/** The original voice with its normal loudness: a video can carry dubbed and DRC tracks too. */
function summarizeAudio(formats: RawFormat[]): OfferedAudio[] {
  const tracks = formats
    .filter((format) => format.vcodec === 'none' && format.format_id && !format.format_id.endsWith('-drc'))
    .sort((a, b) => (b.language_preference ?? 0) - (a.language_preference ?? 0) || (sizeOf(b) ?? 0) - (sizeOf(a) ?? 0));
  const best = new Map<OfferedAudio['codec'], OfferedAudio>();
  for (const format of tracks) {
    const codec = format.acodec ? audioCodecOf(format.acodec) : null;
    if (codec && !best.has(codec)) best.set(codec, { id: format.format_id!, codec, bytes: sizeOf(format) });
  }
  return [...best.values()];
}

/** What this video really offers, one entry per quality and codec, without any signed link. */
export function summarizeFormats(formats: RawFormat[]): VideoFormats {
  const best = new Map<string, OfferedFormat>();
  for (const format of formats) {
    const entry = toOffered(format);
    if (!entry) continue;
    const key = `${entry.quality}-${entry.codec}-${entry.hdr}`;
    const current = best.get(key);
    if (!current || isBetter(entry, current)) best.set(key, entry);
  }
  const codecs = CODEC_ORDER.compatible;
  return {
    offered: [...best.values()].sort((a, b) => (
      b.quality - a.quality || codecs.indexOf(a.codec) - codecs.indexOf(b.codec) || Number(a.hdr) - Number(b.hdr)
    )),
    audio: summarizeAudio(formats),
  };
}

/**
 * The one decision, made by the sheet and the worker alike. Quality comes first: 4K means 4K
 * even when the codec asked for stops lower, because YouTube has no H.264 above 1080p.
 */
export function pickOffered({ offered }: VideoFormats, quality: string, codec: string, hdr = false): OfferedFormat | null {
  const limit = quality === 'best' ? Infinity : Number(quality);
  const top = (offered.find((format) => format.quality <= limit) ?? offered.at(-1))?.quality;
  const order = CODEC_ORDER[codec as YoutubeCodec] ?? CODEC_ORDER.compatible;
  const wantHdr = hdr || codec === 'best';
  const rank = (format: OfferedFormat) => order.indexOf(format.codec) * 2 + Number(format.hdr !== wantHdr);
  return offered.filter((format) => format.quality === top).sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** A copy with the sound that suits it, and what the two come to. */
export function downloadOf({ audio }: VideoFormats, video: OfferedFormat): PickedDownload {
  const track = video.muxed ? null : audio.find(({ codec }) => codec === (video.codec === 'h264' ? 'aac' : 'opus')) ?? audio[0] ?? null;
  const known = video.bytes !== null && (video.muxed || track?.bytes != null);
  return {
    video,
    audio: track,
    bytes: known ? video.bytes! + (track?.bytes ?? 0) : null,
    // A sound Helprr cannot name is still sound: every file must have one.
    selector: video.muxed ? video.id : `${video.id}+${track?.id ?? 'ba'}`,
  };
}

export function pickDownload(formats: VideoFormats, quality: string, codec: string, hdr = false, exactId?: string): PickedDownload | null {
  // The copy a person saw in the sheet, for as long as YouTube still has it. Only ever an id from
  // this list, so nothing sent by a browser reaches yt-dlp.
  const video = formats.offered.find(({ id }) => id === exactId) ?? pickOffered(formats, quality, codec, hdr);
  return video && downloadOf(formats, video);
}

const CODEC_LABELS: Record<OfferedFormat['codec'], string> = { h264: 'H.264', vp9: 'VP9', av1: 'AV1' };

export const codecLabelOf = ({ codec, hdr }: Pick<OfferedFormat, 'codec' | 'hdr'>) => `${CODEC_LABELS[codec]}${hdr ? ' HDR' : ''}`;

/** "4K (3840×1920), 60 fps". */
export function resolutionLabel({ quality, width, height, fps }: Pick<OfferedFormat, 'quality' | 'width' | 'height' | 'fps'>): string {
  return `${qualityLabel(quality)} (${width}×${height})${fps > 30 ? `, ${fps} fps` : ''}`;
}
