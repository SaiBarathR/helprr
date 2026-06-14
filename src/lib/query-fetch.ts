// Shared client-side fetcher for TanStack Query. Replaces the per-page
// `sonarrFetch`/`radarrFetch`/`lidarrFetch` + `withInstanceQuery` copies and the
// silent `r.ok ? r.json() : []` fallback: a non-ok response now throws an
// ApiError (carrying the status) so queries surface a real error state and the
// global 401 handler can redirect to /login.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// A misconfigured *arr can answer 200 with a non-array body (e.g. its web UI
// when the URL/key is wrong); never let that white-screen a library. Use as a
// query `select` so consumers always get an array. A real !ok still throws in
// jsonFetcher, so genuine failures surface as an error instead of empty data.
export const ensureArray = <T,>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);

// Polling parity helper. Reproduces useVisibleInterval's exponential backoff
// (base → 2× → … capped at 60s, reset on success) as a TanStack `refetchInterval`
// function. Pair with `refetchIntervalInBackground: false` (pause when the tab is
// hidden) and `refetchOnWindowFocus: true` (refetch immediately on return) to
// fully match useVisibleInterval's behavior for live/polling views.
export function backoffRefetchInterval(baseMs: number) {
  return (query: { state: { fetchFailureCount: number } }): number =>
    Math.min(baseMs * 2 ** query.state.fetchFailureCount, 60_000);
}

/** Append `?instanceId=<id>` to an API path (no-op when undefined). */
export function withInstanceQuery(url: string, instanceId?: string): string {
  if (!instanceId) return url;
  return `${url}${url.includes('?') ? '&' : '?'}instanceId=${encodeURIComponent(instanceId)}`;
}

/**
 * queryFn factory: GET `<path>` (+ optional instanceId), throw on !ok, return
 * typed JSON. `signal` is threaded through so TanStack cancels in-flight
 * requests on unmount/refetch.
 *
 *   queryFn: jsonFetcher<QualityProfile[]>('/api/sonarr/qualityprofiles', instanceId)
 */
export function jsonFetcher<T>(path: string, instanceId?: string) {
  return async ({ signal }: { signal?: AbortSignal } = {}): Promise<T> => {
    const res = await fetch(withInstanceQuery(path, instanceId), { signal });
    if (!res.ok) throw new ApiError(res.status, `GET ${path} → ${res.status}`);
    return (await res.json()) as T;
  };
}
