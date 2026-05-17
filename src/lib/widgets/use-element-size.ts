'use client';

import { useCallback, useEffect, useState } from 'react';

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * Tracks the live border-box dimensions of a DOM element via ResizeObserver.
 * Returns a callback ref to attach to the element you want to measure, plus
 * the current width/height in pixels. Initial render reports {0, 0}; the
 * observer fires synchronously once the element mounts.
 *
 * Uses a callback ref + state so the observer is wired up whenever the
 * element actually attaches — important for widgets that conditionally
 * render `null` first and only later render the ref-bearing div (e.g. when
 * waiting for store-hydrated layout data). An object-ref + empty-deps
 * useEffect would miss that delayed attachment.
 */
export function useElementSize<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

  // Capture the initial measurement when the node attaches so we don't flash
  // 0/0 for the frame before ResizeObserver's first callback lands. Also
  // updates `el` state so the observer effect below can re-run for late or
  // remounted nodes.
  const ref = useCallback((node: T | null) => {
    setEl(node);
    if (node) {
      setSize({ width: node.offsetWidth, height: node.offsetHeight });
    }
  }, []);

  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ width: el.offsetWidth, height: el.offsetHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  return { ref, width: size.width, height: size.height };
}
