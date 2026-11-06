'use client';

import { useEffect } from 'react';

const SW_URL = process.env.NODE_ENV === 'production' ? '/sw.js' : '/sw-push.js';

// The only registration: Serwist's own is off (next.config.ts). Firefox private
// windows and some in-app browsers have no usable container, or one whose
// register() throws or resolves to nothing; none of that may reject unhandled.
export async function registerServiceWorker(): Promise<void> {
  try {
    const container = navigator.serviceWorker;
    if (typeof container?.register !== 'function') return;
    await container.register(SW_URL);
  } catch (err) {
    console.warn('[SW] Registration failed:', err);
  }
}

export function ServiceWorkerRegister() {
  useEffect(() => {
    void registerServiceWorker();
  }, []);

  return null;
}
