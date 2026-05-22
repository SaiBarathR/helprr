const TAG_PALETTE = [
  '#f59e0b', // amber
  '#f43f5e', // rose
  '#ec4899', // pink
  '#a855f7', // purple
  '#6366f1', // indigo
  '#3b82f6', // blue
  '#06b6d4', // cyan
  '#10b981', // emerald
  '#84cc16', // lime
  '#ef4444', // red
] as const;

export function pickTagColor(name: string): string {
  let h = 5381;
  for (let i = 0; i < name.length; i++) {
    h = (h * 33) ^ name.charCodeAt(i);
  }
  const idx = (h >>> 0) % TAG_PALETTE.length;
  return TAG_PALETTE[idx];
}

export function normalizeTagName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

export const VALID_SOURCES = ['TMDB', 'TVDB', 'ANILIST', 'SONARR', 'RADARR'] as const;
export type WatchlistSource = (typeof VALID_SOURCES)[number];

export const VALID_MEDIA_TYPES = ['movie', 'series', 'anime'] as const;
export type WatchlistMediaType = (typeof VALID_MEDIA_TYPES)[number];

export function isValidSource(s: string): s is WatchlistSource {
  return (VALID_SOURCES as readonly string[]).includes(s);
}

export function isValidMediaType(m: string): m is WatchlistMediaType {
  return (VALID_MEDIA_TYPES as readonly string[]).includes(m);
}

export function watchlistHrefFor(
  source: string,
  externalId: string,
  mediaType: string
): string | null {
  if (source === 'ANILIST') return `/anime/${externalId}`;
  if (source === 'SONARR') return `/series/${externalId}`;
  if (source === 'RADARR') return `/movies/${externalId}`;
  if (source === 'TMDB' && mediaType === 'movie') return `/discover/movie/${externalId}`;
  if (source === 'TMDB' && mediaType === 'series') return `/discover/tv/${externalId}`;
  if (source === 'TVDB' && mediaType === 'series') return null;
  return null;
}
