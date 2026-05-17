'use client';

import { useSyncExternalStore } from 'react';

// Cache MediaQueryList instances per (maxWidth, document) so getSnapshot does
// not allocate a fresh query object on every render.
const mqCache = new Map<number, MediaQueryList>();

function getMediaQuery(maxWidth: number): MediaQueryList | null {
  if (typeof window === 'undefined') return null;
  let mq = mqCache.get(maxWidth);
  if (!mq) {
    mq = window.matchMedia(`(max-width: ${maxWidth}px)`);
    mqCache.set(maxWidth, mq);
  }
  return mq;
}

export function useIsMobile(maxWidth = 768): boolean {
  return useSyncExternalStore(
    (callback) => {
      const mq = getMediaQuery(maxWidth);
      if (!mq) return () => {};
      mq.addEventListener('change', callback);
      return () => mq.removeEventListener('change', callback);
    },
    () => getMediaQuery(maxWidth)?.matches ?? false,
    () => false,
  );
}
