'use client';

import { useEffect, useRef, useState } from 'react';

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * Tracks the live border-box dimensions of a DOM element via ResizeObserver.
 * Returns a ref to attach to the element you want to measure, plus the current
 * width/height in pixels. Initial render reports {0, 0}; the first observer
 * callback fires synchronously after mount so widgets typically see real
 * numbers on the second render.
 */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    setSize({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  return { ref, width: size.width, height: size.height };
}
