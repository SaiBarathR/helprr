import { localDate } from '@/lib/twitch/naming';

const HEADER = '<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n';

function xml(value: string): string {
  // Characters XML 1.0 cannot carry at all, then the five it must escape.
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const tag = (name: string, value: string | number) => `  <${name}>${xml(String(value))}</${name}>\n`;

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

export function seasonNfo(title: string, seasonNumber: number): string {
  return `${HEADER}<season>\n${tag('title', title)}${tag('seasonnumber', seasonNumber)}</season>\n`;
}
