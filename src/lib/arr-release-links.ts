/*
 * Release and history fields that can hold a credential: Prowlarr's proxied
 * download link carries its API key (`…/download?apikey=…`), an indexer's own
 * link its key or passkey, and a private tracker's magnet (or a release id that
 * is the download link itself) its passkey. Helprr reads none of them: grabs go
 * by indexerId + the release's own guid, which the *arr keeps in its search
 * cache. So the Sonarr, Radarr and Lidarr clients drop them as they arrive, and
 * no route can pass them on to a browser.
 */

const RELEASE_LINK_FIELDS = ['downloadUrl', 'magnetUrl'] as const;
// A history record's release id is no use to Helprr (it matches on downloadId).
const HISTORY_DATA_LINK_FIELDS = ['downloadUrl', 'magnetUrl', 'guid'] as const;

/*
 * The indexer's page links are shown and opened, so they stay, but only as an
 * http(s) link without user info, without a query parameter named like a key
 * (the names Helprr's log and manual-download redaction hide, in any case, with
 * a trailing [] or stray spaces), and without a fragment that holds a value.
 * The rest of the query is kept as written. Not covered: a key in the path,
 * which no name gives away. An unusual tracker definition could otherwise put
 * its key in a details link.
 */
const RELEASE_PAGE_FIELDS = ['infoUrl', 'commentUrl'] as const;
const HISTORY_DATA_PAGE_FIELDS = ['nzbInfoUrl'] as const;
const KEY_PARAM = /^(?:api[_-]?(?:key|token)|pass[_-]?key|auth[_-]?key|torrent[_-]?pass|rss[_-]?key|access[_-]?token|key|pid|token|secret|password|sid|sig|signature)$/i;

function isKeyName(raw: string): boolean {
  let name = raw;
  try {
    name = decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    // A malformed escape: judged as written.
  }
  return KEY_PARAM.test(name.replace(/[\s\u0000-\u001f]/g, '').replace(/\[\]$/, ''));
}

// A parameter goes when it, or any ;-separated part of it, is named like a key.
const isKeyParam = (part: string) => part.split(';').some((piece) => isKeyName(piece.split('=')[0]));

/** The link without its credentials, or null when it is not an http(s) link. */
export function pageLinkWithoutKeys(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.username = '';
  url.password = '';
  const parts = url.search.slice(1).split('&');
  const kept = parts.filter((part) => !isKeyParam(part));
  if (kept.length < parts.length) url.search = kept.length > 0 ? `?${kept.join('&')}` : '';
  if (url.hash.includes('=')) url.hash = '';
  return url.toString();
}

function without<T extends object>(item: T, fields: readonly string[], pageFields: readonly string[]): T {
  const copy = { ...item } as Record<string, unknown>;
  for (const field of fields) delete copy[field];
  for (const field of pageFields) {
    if (!(field in copy)) continue;
    const link = pageLinkWithoutKeys(copy[field]);
    if (link === null) delete copy[field];
    else copy[field] = link;
  }
  return copy as T;
}

/** Search results without their download links, and page links without keys (a non-list answer is left alone). */
export function withoutReleaseLinks<T extends object>(releases: T[]): T[] {
  if (!Array.isArray(releases)) return releases;
  return releases.map((release) => (release && typeof release === 'object' ? without(release, RELEASE_LINK_FIELDS, RELEASE_PAGE_FIELDS) : release));
}

/** History records whose `data` keeps everything but the release's links, and its page link without keys. */
export function withoutHistoryLinks<T extends { data?: unknown }>(records: T[]): T[] {
  if (!Array.isArray(records)) return records;
  return records.map((record) => {
    if (!record || typeof record !== 'object' || !record.data || typeof record.data !== 'object') return record;
    return { ...record, data: without(record.data as Record<string, unknown>, HISTORY_DATA_LINK_FIELDS, HISTORY_DATA_PAGE_FIELDS) };
  });
}

/** A history page with its records stripped as above. */
export function historyPageWithoutLinks<T extends { records?: { data?: unknown }[] }>(page: T): T {
  if (!page || typeof page !== 'object' || !Array.isArray(page.records)) return page;
  return { ...page, records: withoutHistoryLinks(page.records) };
}
