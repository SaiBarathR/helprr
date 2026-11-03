const VIDEO_ID = /^[\w-]{11}$/;
const CHANNEL_ID = /^UC[\w-]{22}$/;
const PLAYLIST_ID = /^(?:PL|OL|UU|FL|RD)[\w-]{10,60}$/;
const HANDLE = /^[A-Za-z0-9._-]{3,30}$/;
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const SHORT_HOST = 'youtu.be';

export const isVideoId = (value: string) => VIDEO_ID.test(value);
export const isChannelId = (value: string) => CHANNEL_ID.test(value);
export const isPlaylistId = (value: string) => PLAYLIST_ID.test(value);

function parseUrl(text: string): URL | null {
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    // The origin leaves out sign-in details, so a link carrying them does not start with it.
    return url.port || !url.href.startsWith(`${url.origin}/`) ? null : url;
  } catch {
    return null;
  }
}

export type ChannelQuery = { handle: string } | { channelId: string };

/** A pasted @handle or channel link. The result reaches the API only, never a command line. */
export function parseChannelInput(input: string): ChannelQuery | null {
  const text = input.trim();
  if (text.startsWith('@')) return HANDLE.test(text.slice(1)) ? { handle: text.slice(1) } : null;
  if (isChannelId(text)) return { channelId: text };
  if (!text.includes('/')) return null;
  const url = parseUrl(text);
  if (!url || !HOSTS.has(url.hostname)) return null;
  const [first, second] = url.pathname.split('/').filter(Boolean);
  if (first?.startsWith('@')) return HANDLE.test(first.slice(1)) ? { handle: first.slice(1) } : null;
  if (first === 'channel' && second && isChannelId(second)) return { channelId: second };
  return null;
}

/** The video id from a pasted link. Everything else about the link is thrown away. */
export function parseVideoLink(input: string): string | null {
  const url = parseUrl(input.trim());
  if (!url) return null;
  let id: string | null = null;
  if (url.hostname === SHORT_HOST) {
    id = url.pathname.split('/').filter(Boolean)[0] ?? null;
  } else if (HOSTS.has(url.hostname)) {
    const [first, second] = url.pathname.split('/').filter(Boolean);
    id = first === 'watch' ? url.searchParams.get('v') : ['shorts', 'live', 'embed'].includes(first) ? second : null;
  }
  return id && isVideoId(id) ? id : null;
}

export function parsePlaylistLink(input: string): string | null {
  const url = parseUrl(input.trim());
  if (!url || !HOSTS.has(url.hostname)) return null;
  const id = url.searchParams.get('list');
  return id && isPlaylistId(id) ? id : null;
}
