'use client';

import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/query-fetch';
import {
  EMPTY_BADGE_COUNTS,
  type BadgeArea,
  type BadgeCounts,
  type BadgeSlice,
} from '@/types/badges';

const BADGES_KEY = ['badges'] as const;

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
  const qc = useQueryClient();

  // One shared slow poll for the whole app shell. refetchIntervalInBackground:false
  // pauses while the tab is hidden; refetchOnWindowFocus:true refetches on return —
  // matching the old visibility-aware loop. Optimistic nudges below write the cache
  // directly so actions feel instant; this poll reconciles against server truth.
  const { data } = useQuery({
    queryKey: BADGES_KEY,
    queryFn: async ({ signal }): Promise<BadgeCounts> => {
      const res = await fetch('/api/badges', { cache: 'no-store', signal });
      if (!res.ok) throw new ApiError(res.status, `GET /api/badges → ${res.status}`);
      return (await res.json()) as BadgeCounts;
    },
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    // Just under the poll interval: the 45s timer drives the refresh, so the
    // count stays fresh without an extra cache-bypassing fetch on every mount /
    // re-render within the window. Explicit refreshBadges() still invalidates.
    staleTime: POLL_MS - 5_000,
  });
  const counts = data ?? EMPTY_BADGE_COUNTS;

  const refreshBadges = useCallback(() => {
    void qc.invalidateQueries({ queryKey: BADGES_KEY });
  }, [qc]);

  const setBadge = useCallback(
    (area: BadgeArea, slice: BadgeSlice) => {
      qc.setQueryData<BadgeCounts>(BADGES_KEY, (prev) => ({
        ...(prev ?? EMPTY_BADGE_COUNTS),
        [area]: clampSlice(slice),
      }));
    },
    [qc],
  );

  const adjustBadge = useCallback(
    (area: BadgeArea, deltaTotal: number, deltaAttention = 0) => {
      qc.setQueryData<BadgeCounts>(BADGES_KEY, (prev) => {
        const base = prev ?? EMPTY_BADGE_COUNTS;
        const cur = base[area];
        return {
          ...base,
          [area]: clampSlice({
            total: cur.total + deltaTotal,
            attention: cur.attention + deltaAttention,
          }),
        };
      });
    },
    [qc],
  );

  // Mirror the unread count onto the home-screen app icon from one place,
  // whenever it changes.
  useEffect(() => {
    syncAppBadge(counts.notifications.total);
  }, [counts.notifications.total]);

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
