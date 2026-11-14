'use client';

import { useEffect, useRef } from 'react';

const INTENT_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
const SETTLE_MS = 3000;

/**
 * For a section a link opens by hash (`/page#id`): keeps it at the top of the
 * view while the page around it is still loading. The browser (and Next's
 * Link) scroll to the hash once, on arrival, but sections above it that load
 * afterwards (push state, the event list) push it back out of view. It stops
 * at the first scroll, tap or key, or after a few seconds. The element needs a
 * scroll-margin-top for the sticky header.
 */
export function useHashTarget<T extends HTMLElement>(id: string) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const target = ref.current;
    if (!target || window.location.hash !== `#${id}`) return;

    const align = () => target.scrollIntoView({ block: 'start' });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(align) : null;
    let timer = 0;
    const stop = () => {
      observer?.disconnect();
      window.clearTimeout(timer);
      document.removeEventListener('animationend', align, true);
      for (const event of INTENT_EVENTS) window.removeEventListener(event, stop, true);
    };

    align();
    // The page's entry animation shifts it by a few pixels once it ends.
    document.addEventListener('animationend', align, true);
    observer?.observe(document.body);
    for (const event of INTENT_EVENTS) window.addEventListener(event, stop, { capture: true, passive: true });
    timer = window.setTimeout(stop, SETTLE_MS);
    return stop;
  }, [id]);

  return ref;
}
