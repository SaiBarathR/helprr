'use client';

import { useEffect, useRef } from 'react';

const MAX_BACKOFF_MS = 60_000;
const MAX_FAILURE_EXP = 6; // cap 2^n growth before Math.min clamps it anyway

export interface VisibleIntervalOptions {
  /** When false the loop is torn down entirely (e.g. poll only while a job runs). */
  enabled?: boolean;
  /**
   * Run the callback once on mount even if the tab starts hidden. Preserves the
   * "fetch on mount, then poll" behavior every page relied on with setInterval.
   * Only *subsequent* ticks are visibility-gated.
   */
  runOnMountWhenHidden?: boolean;
}

/**
 * Drop-in replacement for a polling `setInterval` that:
 *   - only fetches while the tab/PWA is visible (pauses when backgrounded),
 *   - fires immediately on return to the foreground (so data is never stale once
 *     you look), modeled on badge-provider's visibilitychange pattern,
 *   - dedupes overlapping calls (a slow request never stacks on the next tick),
 *   - backs off exponentially on failure (base → 2× → … capped at 60s) and
 *     resets to base on the next success.
 *
 * Notes:
 *   - The callback should THROW on failure to drive backoff. Callbacks that
 *     swallow errors simply never back off (their delay stays at base).
 *   - Pausing here only affects on-screen auto-refresh; server-side polling,
 *     push notifications, and badge sync are independent and unaffected.
 */
export function useVisibleInterval(
  callback: () => void | Promise<void>,
  baseIntervalMs: number,
  options: VisibleIntervalOptions = {}
): void {
  const { enabled = true, runOnMountWhenHidden = true } = options;

  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let inFlight = false;

    const isVisible = () => document.visibilityState === 'visible';

    const run = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        await callbackRef.current();
        failures = 0;
      } catch {
        failures = Math.min(failures + 1, MAX_FAILURE_EXP);
      } finally {
        inFlight = false;
      }
    };

    const schedule = () => {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      const delay = Math.min(baseIntervalMs * 2 ** failures, MAX_BACKOFF_MS);
      timer = setTimeout(tick, delay);
    };

    const tick = async () => {
      if (cancelled) return;
      // While hidden we stop the loop entirely; onVisible() restarts it.
      if (!isVisible()) return;
      await run();
      schedule();
    };

    const startNow = async () => {
      if (cancelled) return;
      await run();
      schedule();
    };

    // Initial run: fetch once on mount (respecting runOnMountWhenHidden), then
    // hand off to the visibility-gated loop.
    if (isVisible() || runOnMountWhenHidden) {
      void startNow();
    }

    const onVisible = () => {
      if (cancelled) return;
      if (isVisible()) {
        void startNow();
      } else if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, baseIntervalMs, runOnMountWhenHidden]);
}
