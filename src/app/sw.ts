/// <reference lib="webworker" />

import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from 'serwist';
import { CacheFirst, ExpirationPlugin, NetworkOnly, Serwist, StaleWhileRevalidate } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope & typeof globalThis;

const runtimeCaching: RuntimeCaching[] =
  process.env.NODE_ENV !== 'production'
    ? [
        {
          matcher: /.*/i,
          handler: new NetworkOnly(),
        },
      ]
    : [
        {
          matcher: ({ sameOrigin, url: { pathname } }) => sameOrigin && pathname.startsWith('/api/'),
          method: 'GET',
          handler: new NetworkOnly(),
        },
        {
          matcher: ({ request, sameOrigin, url: { pathname } }) =>
            sameOrigin && !pathname.startsWith('/api/') && request.headers.get('RSC') === '1',
          method: 'GET',
          handler: new NetworkOnly(),
        },
        {
          matcher: ({ request, sameOrigin, url: { pathname } }) =>
            sameOrigin && !pathname.startsWith('/api/') && request.mode === 'navigate',
          method: 'GET',
          handler: new NetworkOnly(),
        },
        {
          matcher: ({ sameOrigin, url: { pathname } }) => sameOrigin && pathname.startsWith('/_next/static/'),
          method: 'GET',
          handler: new CacheFirst({
            cacheName: 'next-static-assets',
            plugins: [
              new ExpirationPlugin({
                maxEntries: 96,
                maxAgeSeconds: 7 * 24 * 60 * 60,
                maxAgeFrom: 'last-used',
              }),
            ],
          }),
        },
        {
          matcher: ({ sameOrigin, url: { pathname } }) => sameOrigin && pathname.startsWith('/_next/image'),
          method: 'GET',
          handler: new StaleWhileRevalidate({
            cacheName: 'next-image-assets',
            plugins: [
              new ExpirationPlugin({
                maxEntries: 96,
                maxAgeSeconds: 24 * 60 * 60,
                maxAgeFrom: 'last-used',
              }),
            ],
          }),
        },
        {
          matcher: /\.(?:png|jpg|jpeg|svg|gif|webp|ico|avif)$/i,
          method: 'GET',
          handler: new StaleWhileRevalidate({
            cacheName: 'static-image-assets',
            plugins: [
              new ExpirationPlugin({
                maxEntries: 96,
                maxAgeSeconds: 30 * 24 * 60 * 60,
                maxAgeFrom: 'last-used',
              }),
            ],
          }),
        },
        {
          matcher: /\.(?:woff|woff2|ttf|otf)$/i,
          method: 'GET',
          handler: new StaleWhileRevalidate({
            cacheName: 'font-assets',
            plugins: [
              new ExpirationPlugin({
                maxEntries: 12,
                maxAgeSeconds: 7 * 24 * 60 * 60,
                maxAgeFrom: 'last-used',
              }),
            ],
          }),
        },
        {
          matcher: ({ sameOrigin }) => !sameOrigin,
          method: 'GET',
          handler: new NetworkOnly(),
        },
        {
          matcher: /.*/i,
          method: 'GET',
          handler: new NetworkOnly(),
        },
      ];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
});

function logToClients(level: 'debug' | 'info' | 'warn' | 'error', message: string, metadata?: unknown) {
  self.clients
    .matchAll({ type: 'window', includeUncontrolled: true })
    .then((clients) => {
      for (const client of clients) {
        client.postMessage({ type: 'helprr-sw-log', level, message, metadata });
      }
    })
    .catch(() => {});
}

// Pull the live unread count for this device's session and mirror it onto the
// home-screen app icon. Same-origin fetch carries the session cookie, so the
// count is scoped to whoever is signed in here. Feature-detected.
async function updateAppBadge(): Promise<void> {
  const nav = self.navigator as WorkerNavigator & {
    setAppBadge?: (count?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  if (!nav.setAppBadge) return;
  // Bound the fetch so a hanging request can't keep the push handler (and thus
  // the service worker) alive via waitUntil.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch('/api/badges', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
    if (!res.ok) return;
    const data = (await res.json()) as { notifications?: { total?: number } };
    const count = data.notifications?.total ?? 0;
    if (count > 0) await nav.setAppBadge(count);
    else await nav.clearAppBadge?.();
  } catch (error) {
    logToClients('error', 'Service worker app-badge update failed', { error: String(error) });
  } finally {
    clearTimeout(timeout);
  }
}

// Push notification handler
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data: { body?: string; tag?: string; url?: string; title?: string };
  try {
    data = event.data.json();
  } catch (error) {
    logToClients('error', 'Service worker push payload parse failed', { error: String(error) });
    return;
  }
  const options: NotificationOptions = {
    body: data.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'helprr-notification',
    data: { url: data.url || '/notifications' },
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || 'Helprr', options),
      updateAppBadge(),
    ])
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/dashboard';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          (client as WindowClient).navigate(url);
          return;
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

self.addEventListener('error', (event) => {
  logToClients('error', event.message || 'Service worker error', {
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
  });
});

self.addEventListener('unhandledrejection', (event) => {
  logToClients('error', 'Service worker unhandled rejection', { reason: String(event.reason) });
});

serwist.addEventListeners();
