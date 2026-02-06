'use client';

import { useEffect } from 'react';

const SW_URL = process.env.NODE_ENV === 'production' ? '/sw.js' : '/sw-push.js';

export function ServiceWorkerRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register(SW_URL).catch((err) => {
        console.warn('[SW] Registration failed:', err);
      });
    }
  }, []);

  return null;
}
