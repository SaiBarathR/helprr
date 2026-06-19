'use client';

import { useEffect } from 'react';

const SW_FILE = process.env.NODE_ENV === 'production' ? 'sw.js' : 'sw-push.js';
const SW_URL = `/${SW_FILE}`;

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    void (async () => {
      try {
        // Dev and prod share one origin (port 3050 via the tunnel). Switching
        // builds leaves the *other* mode's worker registered: a stale Serwist
        // prod worker keeps serving precached prod assets to the dev server
        // (chunk mismatches → reload churn), or a dev push-only worker lingers in
        // prod. Drop any wrong-mode worker + its caches before registering. We
        // only clear on a detected mismatch, so steady-state precaching is intact.
        const regs = await navigator.serviceWorker.getRegistrations();
        const mismatched = regs.filter((reg) => {
          const url =
            reg.active?.scriptURL ?? reg.waiting?.scriptURL ?? reg.installing?.scriptURL ?? '';
          return url !== '' && !url.endsWith(SW_FILE);
        });
        if (mismatched.length > 0) {
          await Promise.all(mismatched.map((reg) => reg.unregister()));
          const keys = await caches.keys();
          await Promise.all(keys.map((key) => caches.delete(key)));
        }
        await navigator.serviceWorker.register(SW_URL);
      } catch (err) {
        console.warn('[SW] Registration failed:', err);
      }
    })();
  }, []);

  return null;
}
