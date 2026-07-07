'use client';

import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia('(display-mode: standalone)');
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari exposes standalone as a non-standard navigator property.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

// SSR renders false; the client snapshot takes over on hydration.
export function useIsStandalone(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
