import { localDate } from '@/lib/archive/naming';
import { HEADER, tag, xml } from '@/lib/archive/nfo';

export function youtubeEpisodeNfo(input: {
  title: string;
  channelName: string;
  season: number;
  episode: number;
  date: Date;
  addedAt: Date;
  durationSeconds: number;
  description: string | null;
  type: 'video' | 'live' | 'short';
  videoId: string;
}): string {
  const day = localDate(input.date);
  const plot = `${input.description?.trim() ? `${input.description.trim()}\n` : ''}https://www.youtube.com/watch?v=${input.videoId}`;
  const added = `${localDate(input.addedAt)} ${input.addedAt.toTimeString().slice(0, 8)}`;
  return `${HEADER}<episodedetails>\n${[
    tag('title', input.title),
    tag('showtitle', input.channelName),
    tag('season', input.season),
    tag('episode', input.episode),
    tag('aired', day),
    tag('premiered', day),
    tag('year', input.date.getFullYear()),
    tag('dateadded', added),
    tag('runtime', Math.round(input.durationSeconds / 60)),
    tag('plot', plot),
    tag('studio', 'YouTube'),
    tag('tag', input.type),
    tag('tag', `youtube-${input.videoId}`),
    `  <uniqueid type="youtube" default="true">${xml(input.videoId)}</uniqueid>\n`,
  ].join('')}</episodedetails>\n`;
}

/** Never <lockdata>: a locked series loses NFO data on every episode added later. */
export function youtubeShowNfo(input: { channelName: string; login: string; description: string | null; channelId: string }): string {
  const plot = `${input.description?.trim() ? `${input.description.trim()}\n` : ''}https://www.youtube.com/channel/${input.channelId}`;
  return `${HEADER}<tvshow>\n${[
    tag('title', input.channelName),
    tag('originaltitle', input.login),
    tag('sorttitle', input.channelName),
    tag('plot', plot),
    tag('studio', 'YouTube'),
    tag('tag', 'youtube'),
    `  <uniqueid type="youtube" default="true">${xml(input.channelId)}</uniqueid>\n`,
    tag('status', 'Continuing'),
  ].join('')}</tvshow>\n`;
}
