/** At most what one add takes. */
const MAX_SHARED_LINKS = 20;

function isTorrentFileLink(token: string): boolean {
  try {
    const url = new URL(token);
    return (url.protocol === 'http:' || url.protocol === 'https:') && /\.torrent$/i.test(url.pathname);
  } catch {
    return false;
  }
}

/**
 * The magnet links, and http(s) links whose path ends in .torrent, in a share's
 * text and url; empty when there are none, so the share is resolved as a title.
 * An indexer link that doesn't end in .torrent can't be told from any other
 * page, so it is left to the title resolution too.
 */
export function sharedTorrentLinks(input: { text?: unknown; url?: unknown }): string[] {
  const tokens = [input.url, input.text]
    .flatMap((value) => (typeof value === 'string' ? value.split(/\s+/) : []))
    .filter(Boolean);
  const links = tokens.filter((token) => /^magnet:\?/i.test(token) || isTorrentFileLink(token));
  return [...new Set(links)].slice(0, MAX_SHARED_LINKS);
}
