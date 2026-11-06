import { recordBrowseFreshness } from '@/lib/browse-freshness';
import { ApiError } from '@/lib/query-fetch';

let inFlight: Promise<Record<string, unknown>> | null = null;

/**
 * GET /api/settings. Callers that ask while a request is still running share
 * it; nothing is cached once it settles, so the next call reads fresh data.
 *
 * Shared by the ['settings'] query, the refresh-interval reader and
 * ClientLogCapture. ClientLogCapture is mounted in the root layout, above the
 * QueryProvider, so a query key alone cannot dedupe it.
 */
export function fetchAppSettings(): Promise<Record<string, unknown>> {
  inFlight ??= (async () => {
    const res = await fetch('/api/settings', { cache: 'no-store' });
    recordBrowseFreshness('/api/settings', res);
    if (!res.ok) throw new ApiError(res.status, `GET /api/settings → ${res.status}`);
    return (await res.json()) as Record<string, unknown>;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
