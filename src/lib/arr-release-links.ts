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

function without<T extends object>(item: T, fields: readonly string[]): T {
  const copy = { ...item } as Record<string, unknown>;
  for (const field of fields) delete copy[field];
  return copy as T;
}

/** Search results without their download links (a non-list answer is left alone). */
export function withoutReleaseLinks<T extends object>(releases: T[]): T[] {
  if (!Array.isArray(releases)) return releases;
  return releases.map((release) => (release && typeof release === 'object' ? without(release, RELEASE_LINK_FIELDS) : release));
}

/** History records whose `data` keeps everything but the release's links. */
export function withoutHistoryLinks<T extends { data?: unknown }>(records: T[]): T[] {
  if (!Array.isArray(records)) return records;
  return records.map((record) => {
    if (!record || typeof record !== 'object' || !record.data || typeof record.data !== 'object') return record;
    return { ...record, data: without(record.data as Record<string, unknown>, HISTORY_DATA_LINK_FIELDS) };
  });
}

/** A history page with its records stripped as above. */
export function historyPageWithoutLinks<T extends { records?: { data?: unknown }[] }>(page: T): T {
  if (!page || typeof page !== 'object' || !Array.isArray(page.records)) return page;
  return { ...page, records: withoutHistoryLinks(page.records) };
}
