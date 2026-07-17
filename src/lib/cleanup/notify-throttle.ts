import type { CleanerKind } from './types';

// A broken removal retries every cycle by design (transient upstream errors
// should heal), but the cleanupFailed notification must not fire once per
// interval — at a 1-minute interval that is notification spam. Allow one
// failure notification per cleaner per window; history still records every
// attempt for debugging.
const FAILURE_NOTIFY_WINDOW_MS = 30 * 60_000;

// Survive Next.js dev hot-reload the same way the scheduler state does.
const GLOBAL_KEY = '__helprrCleanupFailureNotifyAt';
const globalAny = globalThis as unknown as Record<string, unknown>;

function store(): Record<string, number> {
  let s = globalAny[GLOBAL_KEY] as Record<string, number> | undefined;
  if (!s) {
    s = {};
    globalAny[GLOBAL_KEY] = s;
  }
  return s;
}

/** True when a cleanupFailed notification may be sent for this cleaner now. */
export function shouldNotifyFailure(cleaner: CleanerKind, now: number = Date.now()): boolean {
  const s = store();
  const last = s[cleaner] ?? 0;
  if (now - last < FAILURE_NOTIFY_WINDOW_MS) return false;
  s[cleaner] = now;
  return true;
}

/** A fully clean cycle re-arms the notification so the NEXT failure is loud. */
export function resetFailureNotify(cleaner: CleanerKind): void {
  delete store()[cleaner];
}
