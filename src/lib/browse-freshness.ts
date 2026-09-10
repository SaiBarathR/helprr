// In-memory provenance only. Bodies and query data remain in TanStack Query.
const snapshots = new Map<string, number>();
const subscribers = new Set<() => void>();
let oldest = 0;
export function recordBrowseFreshness(path: string, response: Response): void {
  if (response.status === 401 || response.status === 403) snapshots.clear();
  else if (response.headers.get('x-helprr-stale') === '1') {
    const at = Number(response.headers.get('x-helprr-snapshot-at'));
    if (at > 0) snapshots.set(path, at);
    if (snapshots.size > 128) snapshots.delete(snapshots.keys().next().value!);
  } else if (response.ok) snapshots.delete(path);
  oldest = snapshots.size ? Math.min(...snapshots.values()) : 0;
  subscribers.forEach((notify) => notify());
}
export const subscribeBrowseFreshness = (notify: () => void) => { subscribers.add(notify); return () => { subscribers.delete(notify); }; };
export const getBrowseFreshness = () => oldest;
