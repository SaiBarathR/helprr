export const QUALITIES = ['best', '2160', '1440', '1080', '720', '480'] as const;
export const CODECS = ['compatible', 'av1', 'vp9', 'best'] as const;
export const SPONSORBLOCK_MODES = ['off', 'mark', 'remove'] as const;

export type YoutubeQuality = (typeof QUALITIES)[number];
export type YoutubeCodec = (typeof CODECS)[number];
export type SponsorblockMode = (typeof SPONSORBLOCK_MODES)[number];

const CODEC_FILTERS: Record<YoutubeCodec, string> = {
  compatible: '[vcodec^=avc1]',
  av1: '[vcodec^=av01]',
  vp9: '[vcodec^=vp09]',
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
