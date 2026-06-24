'use client';

import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';
import { sleep } from '@/lib/utils';

interface UsePullToRefreshOptions {
  /** Called when the gesture passes the threshold. The indicator spins until the returned promise settles. */
  onRefresh: () => unknown | Promise<unknown>;
  /** Skip the gesture entirely (e.g. while a bulk-selection drag is active). */
  disabled?: boolean;
  /** Resisted pull distance (px) required to trigger a refresh. */
  threshold?: number;
  /** Maximum resisted pull distance (px) the indicator travels. */
  maxDistance?: number;
  /** Scroll container that must be at the top before the gesture can refresh. */
  scrollContainerRef?: RefObject<HTMLElement | null>;
}

interface UsePullToRefreshResult {
  /** Current resisted pull distance in px (0 when idle). */
  distance: number;
  /** 0..1 progress toward the threshold. */
  progress: number;
  /** True while onRefresh() is in flight. */
  refreshing: boolean;
}

const DEFAULT_THRESHOLD = 64;
const DEFAULT_MAX = 96;
// Past this raw finger travel we treat the gesture as a pull and start
// resisting/own the touch — below it, brief jitters stay as normal taps/scrolls.
const ENGAGE_SLOP = 6;
// Keep the spinner up at least this long so a fast/cached refresh still reads as
// "refreshing" instead of an imperceptible flash. Shared with the refresh-button hook.
export const REFRESH_MIN_MS = 600;

/**
 * Pull-to-refresh for document-scrolled pages, or a provided scroll container.
 * Engages only when the target is at the top and the gesture starts as a
 * downward drag, on coarse-pointer (touch) devices only.
 */
export function usePullToRefresh({
  onRefresh,
  disabled = false,
  threshold = DEFAULT_THRESHOLD,
  maxDistance = DEFAULT_MAX,
  scrollContainerRef,
}: UsePullToRefreshOptions): UsePullToRefreshResult {
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Latest values mirrored into refs so the stably-bound touch listeners read
  // fresh values without re-subscribing every render.
  const onRefreshRef = useRef(onRefresh);
  const disabledRef = useRef(disabled);
  const refreshingRef = useRef(refreshing);
  const startYRef = useRef<number | null>(null);
  const engagedRef = useRef(false);
  // touchend reads the latest distance without re-binding listeners on each move.
  const distanceRef = useRef(0);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
    disabledRef.current = disabled;
    refreshingRef.current = refreshing;
  }, [onRefresh, disabled, refreshing]);

  const setPullDistance = useCallback((nextDistance: number) => {
    distanceRef.current = nextDistance;
    setDistance(nextDistance);
  }, []);

  const reset = useCallback(() => {
    startYRef.current = null;
    engagedRef.current = false;
    setPullDistance(0);
  }, [setPullDistance]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.matchMedia?.('(pointer: coarse)').matches) return;

    const getScrollTop = () => scrollContainerRef?.current?.scrollTop ?? window.scrollY;

    const onTouchStart = (e: TouchEvent) => {
      if (disabledRef.current || refreshingRef.current) return;
      if (e.touches.length !== 1) return;
      if (getScrollTop() > 0) return;
      startYRef.current = e.touches[0].clientY;
      engagedRef.current = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startYRef.current === null) return;
      // A late scroll (e.g. content grew) cancels the pull.
      if (getScrollTop() > 0) {
        reset();
        return;
      }
      const delta = e.touches[0].clientY - startYRef.current;
      if (delta <= 0) {
        if (engagedRef.current) setPullDistance(0);
        engagedRef.current = false;
        return;
      }
      if (!engagedRef.current && delta < ENGAGE_SLOP) return;
      engagedRef.current = true;
      // Own the gesture so the page doesn't rubber-band/scroll under it.
      if (e.cancelable) e.preventDefault();
      // Diminishing resistance: easy to start, hard to overshoot.
      const resisted = Math.min(maxDistance, delta * 0.5);
      setPullDistance(resisted);
    };

    const onTouchEnd = () => {
      if (startYRef.current === null) return;
      const shouldRefresh = engagedRef.current && distanceRef.current >= threshold;
      startYRef.current = null;
      engagedRef.current = false;
      if (!shouldRefresh) {
        setPullDistance(0);
        return;
      }
      setRefreshing(true);
      setPullDistance(threshold);
      // Hold the spinner until both the refresh settles and the minimum has
      // elapsed, so fast refreshes stay visible and slow ones aren't cut short.
      Promise.all([Promise.resolve(onRefreshRef.current()), sleep(REFRESH_MIN_MS)])
        .catch(() => {})
        .finally(() => {
          setRefreshing(false);
          setPullDistance(0);
        });
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', reset, { passive: true });

    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', reset);
    };
  }, [maxDistance, threshold, reset, scrollContainerRef, setPullDistance]);

  return {
    distance,
    progress: Math.min(1, distance / threshold),
    refreshing,
  };
}
