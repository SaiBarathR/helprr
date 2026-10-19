// Read-only library/dashboard GET routes served NetworkFirst: an online PWA
// always gets fresh data (so a TanStack refetch right after a mutation returns
// the new value — StaleWhileRevalidate used to hand back the cached body and
// only revalidate for the *next* request, which made saves look like they didn't
// stick), falling back to last-known-good only when offline. Allowlist, not
// denylist: anything not matched here stays NetworkOnly, so a future mutation-ish
// or auth-sensitive GET can't silently become cacheable. `/api/me`, `/api/badges`,
// status polls, and auth/session routes are deliberately excluded (per-user /
// must-be-fresh). Live, second-to-second reads (`/api/activity/queue`,
// `/api/qbittorrent/*`) are intentionally *not* listed — they fall through to the
// catch-all NetworkOnly in sw.ts so a cached copy can never show removed downloads.
// Under the *arr prefixes, action-sensitive/transient subpaths (command status
// polls, rename previews, manual-import scans, interactive-search releases,
// lookups, file lists, per-item history/wanted) are carved out via the negative
// lookahead: their answers change the moment an action lands, so a ≤5-min-old
// cached body is exactly the stale data this allowlist must never serve.
// The API's default Cache-Control keeps these storable (private, no-cache).
export const READONLY_API_NETWORK_FIRST =
  /^\/api\/(?:(?:sonarr|radarr|lidarr)(?!\/(?:command|rename|manualimport|release|lookup|moviefile|episodefile|trackfile|history|wanted)\b)|calendar|library-gaps|dashboard-layouts|watchlist|discover|recommendations\/for-you|activity\/(?:history|wanted))(?:\/.*)?$/;

export const SNAPSHOT_TIME_HEADER = 'x-helprr-snapshot-at';
export const SNAPSHOT_STALE_HEADER = 'x-helprr-stale';
export const SNAPSHOT_MAX_AGE_MS = 5 * 60_000;
const MAX_BYTES = 2 * 1024 * 1024;

export async function cacheBrowseSnapshot(response: Response, now = Date.now()): Promise<Response | null> {
  if (response.status !== 200 || !response.headers.get('content-type')?.includes('application/json') || response.headers.get('cache-control')?.includes('no-store')) return null;
  if (Number(response.headers.get('content-length')) > MAX_BYTES) return null;
  const bytes = await response.clone().arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) return null;
  const headers = new Headers(response.headers);
  headers.set(SNAPSHOT_TIME_HEADER, String(now));
  headers.delete(SNAPSHOT_STALE_HEADER);
  return new Response(bytes, { status: 200, headers });
}

export function staleBrowseSnapshot(response: Response | undefined, now = Date.now()): Response | null {
  if (!response) return null;
  const at = Number(response.headers.get(SNAPSHOT_TIME_HEADER));
  // Old worker entries have no timestamp and cannot be represented truthfully.
  if (!at || at > now || now - at > SNAPSHOT_MAX_AGE_MS) return null;
  const headers = new Headers(response.headers);
  headers.set(SNAPSHOT_STALE_HEADER, '1');
  return new Response(response.body, { status: response.status, headers });
}
