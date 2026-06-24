'use client';

import { useCallback, useRef, useState } from 'react';
import { sleep } from '@/lib/utils';
import { REFRESH_MIN_MS } from '@/lib/hooks/use-pull-to-refresh';

interface UseRefreshActionResult {
  /** True while a triggered refresh is in flight (held for the minimum duration). */
  refreshing: boolean;
  /** Runs the action and keeps `refreshing` true until it settles and the minimum elapses. */
  refresh: () => Promise<void>;
}

/**
 * Drives a refresh button's busy state. Keeps `refreshing` true until both the
 * action settles and a minimum duration has elapsed, so a fast/cached refresh
 * shows a perceptible spinner instead of an imperceptible flash.
 */
export function useRefreshAction(action: () => unknown | Promise<unknown>): UseRefreshActionResult {
  const [refreshing, setRefreshing] = useState(false);
  const actionRef = useRef(action);
  actionRef.current = action;
  const refreshingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshingRef.current) return; // ignore re-entry while already refreshing
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      await Promise.all([Promise.resolve(actionRef.current()), sleep(REFRESH_MIN_MS)]);
    } catch {
      /* refetch errors surface via the query's own error state */
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, []);

  return { refreshing, refresh };
}
