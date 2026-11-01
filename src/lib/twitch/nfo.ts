import { localDate } from '@/lib/archive/naming';
import { HEADER, tag, xml } from '@/lib/archive/nfo';

export function episodeNfo(input: {
  title: string;
  displayName: string;
  season: number;
  episode: number;
  date: Date;
  addedAt: Date;
  durationSeconds: number;
  description: string | null;
  type: 'archive' | 'highlight' | 'upload';
  genres: readonly string[];
  twitchVideoId: string;
}): string {
  const day = localDate(input.date);
  const plot = `${input.description?.trim() || `Streamed ${day}.`}\nhttps://www.twitch.tv/videos/${input.twitchVideoId}`;
  const added = `${localDate(input.addedAt)} ${input.addedAt.toTimeString().slice(0, 8)}`;
  return `${HEADER}<episodedetails>\n${[
    tag('title', input.title),
    tag('showtitle', input.displayName),
    tag('season', input.season),
    tag('episode', input.episode),
    tag('aired', day),
    tag('premiered', day),
    tag('year', input.date.getFullYear()),
    tag('dateadded', added),
    tag('runtime', Math.round(input.durationSeconds / 60)),
    tag('plot', plot),
    tag('studio', 'Twitch'),
    ...input.genres.map((genre) => tag('genre', genre)),
    tag('tag', input.type),
    tag('tag', `twitch-v${input.twitchVideoId}`),
    `  <uniqueid type="twitch" default="true">${xml(input.twitchVideoId)}</uniqueid>\n`,
  ].join('')}</episodedetails>\n`;
}

/** Never <lockdata>: a locked series loses NFO data on every episode added later. */
export function tvshowNfo(input: {
  displayName: string;
  login: string;
  description: string | null;
  broadcasterType: string;
  twitchUserId: string;
}): string {
  const plot = `${input.description?.trim() ? `${input.description.trim()}\n` : ''}https://www.twitch.tv/${input.login}`;
  return `${HEADER}<tvshow>\n${[
    tag('title', input.displayName),
    tag('originaltitle', input.login),
    tag('sorttitle', input.login),
    tag('plot', plot),
    tag('studio', 'Twitch'),
    tag('tag', 'twitch'),
    ...(input.broadcasterType ? [tag('tag', input.broadcasterType)] : []),
    `  <uniqueid type="twitch" default="true">${xml(input.twitchUserId)}</uniqueid>\n`,
    tag('status', 'Continuing'),
  ].join('')}</tvshow>\n`;
}
