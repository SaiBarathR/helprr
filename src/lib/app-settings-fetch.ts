import { recordBrowseFreshness } from '@/lib/browse-freshness';
import { ApiError } from '@/lib/query-fetch';

// How long a settled read is reused. Covers the layout and the page asking one
// after the other on the same load, not later reads.
const REUSE_MS = 3_000;

let shared: { promise: Promise<Record<string, unknown>>; settledAt: number | null } | null = null;

/**
 * GET /api/settings. Callers that ask while a request is still running, or
 * within REUSE_MS after it succeeded, share it; later calls read fresh data.
 * Anything that writes settings must call forgetAppSettingsFetch().
 *
 * Shared by the ['settings'] query, the refresh-interval reader and
 * ClientLogCapture. ClientLogCapture is mounted in the root layout, above the
 * QueryProvider, so a query key alone cannot dedupe it.
 */
export function fetchAppSettings(): Promise<Record<string, unknown>> {
  if (shared) {
    // A negative age (the clock went back) counts as expired.
    const age = shared.settledAt === null ? 0 : Date.now() - shared.settledAt;
    if (age >= 0 && age < REUSE_MS) return shared.promise;
  }
  const entry: NonNullable<typeof shared> = {
    promise: (async () => {
      const res = await fetch('/api/settings', { cache: 'no-store' });
      recordBrowseFreshness('/api/settings', res);
      if (!res.ok) throw new ApiError(res.status, `GET /api/settings → ${res.status}`);
      return (await res.json()) as Record<string, unknown>;
    })(),
    settledAt: null,
  };
  shared = entry;
  entry.promise.then(
    () => {
      entry.settledAt = Date.now();
    },
    () => {
      if (shared === entry) shared = null;
    },
  );
  return entry.promise;
}

/** Drop the shared read so the next fetchAppSettings() goes to the server. */
export function forgetAppSettingsFetch(): void {
  shared = null;
}
