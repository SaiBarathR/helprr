'use client';

import { useEffect, useMemo, useState } from 'react';

interface UseWindowVirtualRangeOptions {
  itemCount: number;
  itemSize: number;
  overscan?: number;
  enabled?: boolean;
  container: HTMLElement | null;
}

interface WindowVirtualRange {
  startIndex: number;
  endIndex: number;
  topSpacerHeight: number;
  bottomSpacerHeight: number;
}

export function useWindowVirtualRange({
  itemCount,
  itemSize,
  overscan = 6,
  enabled = true,
  container,
}: UseWindowVirtualRangeOptions): WindowVirtualRange {
  const [snapshot, setSnapshot] = useState({
    scrollY: 0,
    viewportHeight: 0,
    containerTop: 0,
  });

  useEffect(() => {
    if (!enabled || !container) return;

    let frame: number | null = null;

    const measure = () => {
      setSnapshot({
        scrollY: window.scrollY,
        viewportHeight: window.innerHeight,
        containerTop: container.getBoundingClientRect().top + window.scrollY,
      });
    };

    const scheduleMeasure = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        measure();
      });
    };

    scheduleMeasure();

    window.addEventListener('scroll', scheduleMeasure, { passive: true });
    window.addEventListener('resize', scheduleMeasure);

    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(container);

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener('scroll', scheduleMeasure);
      window.removeEventListener('resize', scheduleMeasure);
    };
  }, [enabled, container]);

  return useMemo(() => {
    if (!enabled || itemCount <= 0 || itemSize <= 0 || !container) {
      return {
        startIndex: 0,
        endIndex: itemCount,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
      };
    }

    const visibleStartPx = Math.max(0, snapshot.scrollY - snapshot.containerTop);
    const visibleEndPx = visibleStartPx + snapshot.viewportHeight;

    const startIndex = Math.max(0, Math.floor(visibleStartPx / itemSize) - overscan);
    const endIndex = Math.min(itemCount, Math.ceil(visibleEndPx / itemSize) + overscan);

    return {
      startIndex,
      endIndex,
      topSpacerHeight: startIndex * itemSize,
      bottomSpacerHeight: Math.max(0, (itemCount - endIndex) * itemSize),
    };
  }, [container, enabled, itemCount, itemSize, overscan, snapshot]);
}
