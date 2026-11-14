import { forgetBrowseFreshness, recordBrowseFreshness } from '@/lib/browse-freshness';
import { fetchOrOffline } from '@/lib/network-error';
import { SNAPSHOT_STALE_HEADER, SNAPSHOT_TIME_HEADER } from '@/lib/offline-snapshot';

/** The service worker's saved copy a widget's load was answered with. */
export interface SavedCopy {
  /** When the copy was saved (ms); the oldest one if the load made several requests. */
  at: number;
  paths: string[];
}

// Keyed by the load's AbortSignal, which every widget fetcher already passes
// to fetch(), so a fetcher needs no extra argument to report a saved copy.
const loads = new WeakMap<AbortSignal, SavedCopy>();

/** Called by useWidgetData around one load: the saved copy (if any) its requests got. */
export function watchSavedCopy(signal: AbortSignal): SavedCopy {
  const copy: SavedCopy = { at: 0, paths: [] };
  loads.set(signal, copy);
  return copy;
}

/** The saved copy a load is collecting, for a fetcher that shares its response with later loads. */
export function savedCopyOf(signal: AbortSignal | undefined): SavedCopy | undefined {
  return signal ? loads.get(signal) : undefined;
}

/**
 * A load that reused another load's response (a fetcher's in-memory promise
 * cache, as Discover keeps) takes that response's saved copy with it: else it
 * would count as live, losing the copy's five-minute limit.
 */
export function adoptSavedCopy(signal: AbortSignal | undefined, from: SavedCopy | undefined): void {
  const copy = savedCopyOf(signal);
  if (!copy || !from?.at || copy === from) return;
  copy.at = copy.at ? Math.min(copy.at, from.at) : from.at;
  copy.paths.push(...from.paths);
}

/**
 * fetch() for a widget whose route the service worker may answer offline with
 * a saved copy (READONLY_API_NETWORK_FIRST): that copy shows the shared
 * saved-data notice, as the Calendar page's does, and useWidgetData replaces
 * it with "You're offline" once it is five minutes old.
 */
export async function widgetFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    // An OfflineError marks a request that got no answer (see useWidgetData).
    res = await fetchOrOffline(path, init);
  } catch (error) {
    // Past the copy's five minutes the worker has nothing left to answer with.
    if (!init.signal?.aborted) forgetBrowseFreshness(path);
    throw error;
  }
  recordBrowseFreshness(path, res);
  const copy = init.signal ? loads.get(init.signal) : undefined;
  const at = res.headers.get(SNAPSHOT_STALE_HEADER) === '1' ? Number(res.headers.get(SNAPSHOT_TIME_HEADER)) : 0;
  if (copy && at > 0) {
    copy.at = copy.at ? Math.min(copy.at, at) : at;
    copy.paths.push(path);
  }
  return res;
}
