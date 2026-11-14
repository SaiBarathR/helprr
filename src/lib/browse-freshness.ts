// In-memory provenance only. Bodies and query data remain in TanStack Query.
// Each saved copy remembers the pages (pathnames) it was loaded on, and the
// notice speaks for the current page only: left on, it claimed saved data on
// every later page until that path happened to get a live answer. A page shown
// again keeps its own entries, so coming back to one still on saved data shows
// the notice at once.
const snapshots = new Map<string, { at: number; pages: Set<string> }>();
const subscribers = new Set<() => void>();
const currentPage = () => (typeof location === 'undefined' ? '' : location.pathname);
const notifyAll = () => subscribers.forEach((notify) => notify());
export function recordBrowseFreshness(path: string, response: Response): void {
  if (response.status === 401 || response.status === 403) snapshots.clear();
  else if (response.headers.get('x-helprr-stale') === '1') {
    const at = Number(response.headers.get('x-helprr-snapshot-at'));
    if (at > 0) {
      const pages = snapshots.get(path)?.pages ?? new Set<string>();
      pages.add(currentPage());
      snapshots.set(path, { at, pages });
    }
    if (snapshots.size > 128) snapshots.delete(snapshots.keys().next().value!);
  } else if (response.ok) snapshots.delete(path);
  notifyAll();
}
export const subscribeBrowseFreshness = (notify: () => void) => { subscribers.add(notify); return () => { subscribers.delete(notify); }; };
/** The oldest saved copy loaded on this page (by default the one open now), or 0. */
export function getBrowseFreshness(page = currentPage()): number {
  let oldest = 0;
  for (const { at, pages } of snapshots.values()) {
    if (pages.has(page) && (!oldest || at < oldest)) oldest = at;
  }
  return oldest;
}
/** A saved copy no longer on screen (it expired, or its next request failed) drops out of the notice. */
export function forgetBrowseFreshness(path: string): void {
  if (snapshots.delete(path)) notifyAll();
}
