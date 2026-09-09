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
