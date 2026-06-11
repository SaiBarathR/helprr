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
    if (!res.ok) {
      // Session expired — clear the stale icon badge instead of leaving it.
      if (res.status === 401 || res.status === 403) await nav.clearAppBadge?.();
      return;
    }
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

  let data: {
    body?: string;
    tag?: string;
    url?: string;
    title?: string;
    actions?: { action: string; title: string }[];
    data?: Record<string, unknown>;
  };
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
    // Action buttons (Approve/Decline, Retry) render on Android/desktop Chrome.
    // iOS Web Push ignores `actions`, so iPhone users fall back to tapping the
    // notification body, which deep-links straight to the relevant action view.
    data: { url: data.url || '/notifications', ...(data.data ?? {}) },
    ...(data.actions ? { actions: data.actions } : {}),
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || 'Helprr', options),
      updateAppBadge(),
    ])
  );
});

async function confirm(body: string, tag: string): Promise<void> {
  await self.registration.showNotification('Helprr', {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag,
  });
}

// Acts on a pending Seerr request straight from the notification (no app open).
// Same-origin fetch carries the helprr-session cookie automatically.
async function handleRequestAction(action: string, pendingId: string): Promise<void> {
  try {
    const res = action === 'approve'
      ? await fetch(`/api/seerr/pending-requests/${pendingId}/approve`, { method: 'POST', credentials: 'include' })
      : await fetch(`/api/seerr/pending-requests/${pendingId}`, { method: 'DELETE', credentials: 'include' });
    await confirm(
      res.ok
        ? action === 'approve' ? 'Request approved' : 'Request declined'
        : 'Could not complete — open the app',
      `request-action-${pendingId}`,
    );
  } catch {
    await confirm('Could not complete — open the app', `request-action-${pendingId}`);
  }
}

// Re-searches a failed download (Sonarr episode / Radarr movie) from the
// notification. instanceId scopes the search to the right multi-instance server.
async function handleRetryAction(data: Record<string, unknown>): Promise<void> {
  try {
    const source = data.source;
    const qs = data.instanceId ? `?instanceId=${encodeURIComponent(String(data.instanceId))}` : '';
    let ok = false;
    if (source === 'sonarr' && data.episodeId != null) {
      const res = await fetch(`/api/sonarr/command${qs}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'EpisodeSearch', episodeIds: [data.episodeId] }),
      });
      ok = res.ok;
    } else if (source === 'radarr' && data.movieId != null) {
      const res = await fetch(`/api/radarr/command${qs}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'MoviesSearch', movieIds: [data.movieId] }),
      });
      ok = res.ok;
    }
    await confirm(ok ? 'Retry triggered — searching again' : 'Could not retry — open the app', 'retry-action');
  } catch {
    await confirm('Could not retry — open the app', 'retry-action');
  }
}

function focusOrOpen(url: string): Promise<unknown> {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if (client.url.includes(self.location.origin) && 'focus' in client) {
        client.focus();
        (client as WindowClient).navigate(url);
        return;
      }
    }
    return self.clients.openWindow(url);
  });
}

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  const data = (event.notification.data ?? {}) as Record<string, unknown>;
  const action = event.action;
  event.notification.close();

  if ((action === 'approve' || action === 'decline') && typeof data.pendingId === 'string') {
    event.waitUntil(handleRequestAction(action, data.pendingId));
    return;
  }
  if (action === 'retry') {
    event.waitUntil(handleRetryAction(data));
    return;
  }

  const url = typeof data.url === 'string' ? data.url : '/dashboard';
  event.waitUntil(focusOrOpen(url));
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
