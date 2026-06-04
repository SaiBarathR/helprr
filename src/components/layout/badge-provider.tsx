'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  EMPTY_BADGE_COUNTS,
  type BadgeArea,
  type BadgeCounts,
  type BadgeSlice,
} from '@/types/badges';

// One slow poll loop for the whole app shell. Badges read from /api/badges,
// which is served from counts the background poll already stashed in Redis — so
// this adds zero load on the *arr services no matter how many tabs/devices poll.
// User actions nudge the counts optimistically (see useBadgeActions) so they
// feel instant; this poll just reconciles against server truth.
const POLL_MS = 45_000;

interface BadgeContextValue {
  counts: BadgeCounts;
  // Force an immediate refetch. Use after an action whose effect can't be
  // computed locally (e.g. a filtered notification delete). Only authoritative
  // for notifications, which /api/badges counts live from the DB; the service
  // areas are Redis-backed and only refresh on the 30s server poll.
  refreshBadges: () => void;
  // Optimistically nudge one area so an action feels instant; the next poll
  // reconciles. Counts clamp at 0.
  adjustBadge: (area: BadgeArea, deltaTotal: number, deltaAttention?: number) => void;
  // Optimistically set one area outright (e.g. mark-all-read → 0/0).
  setBadge: (area: BadgeArea, slice: BadgeSlice) => void;
}

const BadgeContext = createContext<BadgeContextValue>({
  counts: EMPTY_BADGE_COUNTS,
  refreshBadges: () => {},
  adjustBadge: () => {},
  setBadge: () => {},
});

type AppBadgeNavigator = Navigator & {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

// Mirror the unread count onto the home-screen icon (installed PWA, iOS 16.4+).
// Feature-detected; a no-op everywhere it isn't supported.
function syncAppBadge(unread: number): void {
  if (typeof navigator === 'undefined') return;
  const nav = navigator as AppBadgeNavigator;
  if (unread > 0) nav.setAppBadge?.(unread).catch(() => {});
  else nav.clearAppBadge?.().catch(() => {});
}

const clampSlice = (slice: BadgeSlice): BadgeSlice => ({
  total: Math.max(0, slice.total),
  attention: Math.max(0, slice.attention),
});

export function BadgeProvider({ children }: { children: React.ReactNode }) {
  const [counts, setCounts] = useState<BadgeCounts>(EMPTY_BADGE_COUNTS);

  const fetchCounts = useCallback(async () => {
    try {
      const res = await fetch('/api/badges', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as BadgeCounts;
      setCounts(data);
    } catch {
      // Transient network/offline — keep the last known counts.
    }
  }, []);

  const refreshBadges = useCallback(() => {
    void fetchCounts();
  }, [fetchCounts]);

  const setBadge = useCallback((area: BadgeArea, slice: BadgeSlice) => {
    setCounts((prev) => ({ ...prev, [area]: clampSlice(slice) }));
  }, []);

  const adjustBadge = useCallback(
    (area: BadgeArea, deltaTotal: number, deltaAttention = 0) => {
      setCounts((prev) => {
        const cur = prev[area];
        return {
          ...prev,
          [area]: clampSlice({
            total: cur.total + deltaTotal,
            attention: cur.attention + deltaAttention,
          }),
        };
      });
    },
    [],
  );

  // Mirror the unread count onto the home-screen app icon from one place,
  // whenever it changes — keeps the setCounts updaters pure (no side effects).
  useEffect(() => {
    syncAppBadge(counts.notifications.total);
  }, [counts.notifications.total]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled) return;
      // Don't poll a backgrounded tab/PWA — refetch happens on return instead.
      if (document.visibilityState === 'visible') await fetchCounts();
      if (!cancelled) timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();

    const onVisible = () => {
      if (document.visibilityState === 'visible') void fetchCounts();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchCounts]);

  const value = useMemo<BadgeContextValue>(
    () => ({ counts, refreshBadges, adjustBadge, setBadge }),
    [counts, refreshBadges, adjustBadge, setBadge],
  );

  return <BadgeContext.Provider value={value}>{children}</BadgeContext.Provider>;
}

export function useBadgeCounts(): BadgeCounts {
  return useContext(BadgeContext).counts;
}

export function useBadgeActions(): Omit<BadgeContextValue, 'counts'> {
  const { refreshBadges, adjustBadge, setBadge } = useContext(BadgeContext);
  return { refreshBadges, adjustBadge, setBadge };
}
