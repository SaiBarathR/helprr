'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface UsePullToRefreshOptions {
  /** Called when the gesture passes the threshold. The indicator spins until the returned promise settles. */
  onRefresh: () => unknown | Promise<unknown>;
  /** Skip the gesture entirely (e.g. while a bulk-selection drag is active). */
  disabled?: boolean;
  /** Resisted pull distance (px) required to trigger a refresh. */
  threshold?: number;
  /** Maximum resisted pull distance (px) the indicator travels. */
  maxDistance?: number;
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

/**
 * Window-level pull-to-refresh for document-scrolled pages. Engages only when
 * the window is at the top and the gesture starts as a downward drag, on
 * coarse-pointer (touch) devices only.
 */
export function usePullToRefresh({
  onRefresh,
  disabled = false,
  threshold = DEFAULT_THRESHOLD,
  maxDistance = DEFAULT_MAX,
}: UsePullToRefreshOptions): UsePullToRefreshResult {
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Latest values mirrored into refs so the (stably-bound) window listeners read
  // fresh values without re-subscribing every render. Synced in an effect — never
  // mutate refs during render.
  const onRefreshRef = useRef(onRefresh);
  const disabledRef = useRef(disabled);
  const refreshingRef = useRef(refreshing);
  const startYRef = useRef<number | null>(null);
  const engagedRef = useRef(false);
  // touchend reads the latest distance without re-binding listeners on each move.
  const distanceRef = useRef(distance);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
    disabledRef.current = disabled;
    refreshingRef.current = refreshing;
    distanceRef.current = distance;
  });

  const reset = useCallback(() => {
    startYRef.current = null;
    engagedRef.current = false;
    setDistance(0);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.matchMedia?.('(pointer: coarse)').matches) return;

    const onTouchStart = (e: TouchEvent) => {
      if (disabledRef.current || refreshingRef.current) return;
      if (e.touches.length !== 1) return;
      if (window.scrollY > 0) return;
      startYRef.current = e.touches[0].clientY;
      engagedRef.current = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (startYRef.current === null) return;
      // A late scroll (e.g. content grew) cancels the pull.
      if (window.scrollY > 0) {
        reset();
        return;
      }
      const delta = e.touches[0].clientY - startYRef.current;
      if (delta <= 0) {
        if (engagedRef.current) setDistance(0);
        engagedRef.current = false;
        return;
      }
      if (!engagedRef.current && delta < ENGAGE_SLOP) return;
      engagedRef.current = true;
      // Own the gesture so the page doesn't rubber-band/scroll under it.
      if (e.cancelable) e.preventDefault();
      // Diminishing resistance: easy to start, hard to overshoot.
      const resisted = Math.min(maxDistance, delta * 0.5);
      setDistance(resisted);
    };

    const onTouchEnd = () => {
      if (startYRef.current === null) return;
      const shouldRefresh = engagedRef.current && distanceRef.current >= threshold;
      startYRef.current = null;
      engagedRef.current = false;
      if (!shouldRefresh) {
        setDistance(0);
        return;
      }
      setRefreshing(true);
      setDistance(threshold);
      Promise.resolve(onRefreshRef.current())
        .catch(() => {})
        .finally(() => {
          setRefreshing(false);
          setDistance(0);
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
  }, [maxDistance, threshold, reset]);

  return {
    distance,
    progress: Math.min(1, distance / threshold),
    refreshing,
  };
}
