const MAX_TITLE_LENGTH = 120;

/**
 * The filename title is cosmetic: the NFO title is what Jellyfin shows. It only
 * has to be legal, and free of the word "sample", which makes Jellyfin skip the file.
 */
export function safeFilenameTitle(title: string): string {
  const cleaned = title
    .replace(/[<>:"/\\|?*\p{Cc}]/gu, ' ')
    .replace(/sample/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.-]+|[\s.-]+$/g, '');
  const cut = [...cleaned].slice(0, MAX_TITLE_LENGTH).join('').trim();
  return cut || 'Untitled';
}

const pad = (value: number) => String(value).padStart(2, '0');

export function localDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Year as season, MMDDHHMM as episode: chronological, int32-safe, and two same-day VODs stay separate. */
export function archiveEpisode(date: Date): { season: number; episode: number } {
  const stamp = `${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}`;
  return { season: date.getFullYear(), episode: Number(stamp) };
}

export type SeasonKind = 'ARCHIVE' | 'HIGHLIGHT' | 'UPLOAD';

export function seasonFolder(kind: SeasonKind, year: number): string {
  if (kind === 'HIGHLIGHT') return 'Season 01 Highlights';
  if (kind === 'UPLOAD') return 'Season 02 Uploads';
  return `Season ${year}`;
}

export function episodeBaseName(input: {
  folderName: string;
  season: number;
  episode: number;
  date: Date;
  title: string;
  twitchVideoId: string;
}): string {
  const season = String(input.season).padStart(2, '0');
  const episode = String(input.episode).padStart(2, '0');
  return `${input.folderName} - S${season}E${episode} - ${localDate(input.date)} - ${safeFilenameTitle(input.title)} [v${input.twitchVideoId}]`;
}
