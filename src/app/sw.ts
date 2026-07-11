/// <reference lib="webworker" />

import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from 'serwist';
import {
  CacheableResponsePlugin,
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  NetworkOnly,
  Serwist,
  StaleWhileRevalidate,
} from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope & typeof globalThis;

// Read-only library/dashboard GET routes served NetworkFirst: an online PWA
// always gets fresh data (so a TanStack refetch right after a mutation returns
// the new value — StaleWhileRevalidate used to hand back the cached body and
// only revalidate for the *next* request, which made saves look like they didn't
// stick), falling back to last-known-good only when offline. Allowlist, not
// denylist: anything not matched here stays NetworkOnly, so a future mutation-ish
// or auth-sensitive GET can't silently become cacheable. `/api/me`, `/api/badges`,
// status polls, and auth/session routes are deliberately excluded (per-user /
// must-be-fresh). Live, second-to-second reads (`/api/activity/queue`,
// `/api/qbittorrent/*`) are intentionally *not* listed — they fall through to the
// catch-all NetworkOnly below so a cached copy can never show removed downloads.
// Under the *arr prefixes, action-sensitive/transient subpaths (command status
// polls, rename previews, manual-import scans, interactive-search releases,
// lookups, file lists, per-item history/wanted) are carved out via the negative
// lookahead: their answers change the moment an action lands, so a ≤5-min-old
// cached body is exactly the stale data this allowlist must never serve.
const READONLY_API_NETWORK_FIRST =
  /^\/api\/(?:(?:sonarr|radarr|lidarr)(?!\/(?:command|rename|manualimport|release|lookup|moviefile|episodefile|trackfile|history|wanted)\b)|calendar|library-gaps|dashboard-layouts|watchlist|discover|recommendations\/for-you|activity\/(?:history|wanted))(?:\/.*)?$/;

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
          // Read-only library/dashboard reads → fresh online, offline last-known-good.
          // networkTimeoutSeconds falls back to cache only if the network stalls.
          // CacheableResponsePlugin([200]) means 401/403/3xx are never written, so
          // a revoked session can't read another user's stale data here.
          matcher: ({ sameOrigin, url: { pathname } }) => sameOrigin && READONLY_API_NETWORK_FIRST.test(pathname),
          method: 'GET',
          handler: new NetworkFirst({
            cacheName: 'api-readonly',
            // 10s, not 3: a healthy but slow *arr (large library fetch) regularly
            // exceeds 3s, which would silently swap in a ≤5-min-old cached body.
            networkTimeoutSeconds: 10,
            plugins: [
              new CacheableResponsePlugin({ statuses: [200] }),
              new ExpirationPlugin({
                maxEntries: 128,
                maxAgeSeconds: 5 * 60,
                maxAgeFrom: 'last-used',
              }),
            ],
          }),
        },
        {
          // Proxied poster/artwork images. CacheFirst: the URL carries a
          // ?v=<imageCacheGeneration> stamp (src/lib/image.ts), so an admin purge
          // changes every URL and stale entries age out via LRU — no revalidation
          // needed per load. This is what makes posters instant (and available
          // offline) on a cold PWA start instead of a re-download over mobile data.
          // Auth-gated content, so the cache is user-scoped and cleared on logout.
          matcher: ({ sameOrigin, url: { pathname } }) => sameOrigin && pathname.startsWith('/api/image'),
          method: 'GET',
          handler: new CacheFirst({
            cacheName: 'api-images',
            plugins: [
              new CacheableResponsePlugin({ statuses: [200] }),
              new ExpirationPlugin({
                maxEntries: 500,
                maxAgeSeconds: 7 * 24 * 60 * 60,
                maxAgeFrom: 'last-used',
              }),
            ],
          }),
        },
        {
          // Everything else under /api stays network-only (mutations are POST/DELETE
          // and excluded by method anyway; this is the catch-all for non-allowlisted reads).
          matcher: ({ sameOrigin, url: { pathname } }) => sameOrigin && pathname.startsWith('/api/'),
          method: 'GET',
          handler: new NetworkOnly(),
        },
        {
          // RSC (page-data) fetches MUST stay network-only: the payload shape depends
          // on the Next-Router-State-Tree header, so URL-keyed caching would serve a
          // wrong-shaped subtree and corrupt React reconciliation. Instant intra-app
          // nav comes from prefetch + loading.tsx skeletons instead.
          matcher: ({ request, sameOrigin, url: { pathname } }) =>
            sameOrigin && !pathname.startsWith('/api/') && request.headers.get('RSC') === '1',
          method: 'GET',
          handler: new NetworkOnly(),
        },
        {
          // HTML document navigations → SWR so the installed PWA cold-opens the
          // last-seen shell instantly (and offline). The data inside is fetched
          // separately and every API/RSC call independently re-auths, so a revoked
          // session at worst sees a stale shell for one navigation.
          matcher: ({ request, sameOrigin, url: { pathname } }) =>
            sameOrigin && !pathname.startsWith('/api/') && request.mode === 'navigate',
          method: 'GET',
          handler: new StaleWhileRevalidate({
            cacheName: 'pages',
            plugins: [
              new CacheableResponsePlugin({ statuses: [200] }),
              new ExpirationPlugin({
                maxEntries: 64,
                maxAgeSeconds: 24 * 60 * 60,
                maxAgeFrom: 'last-used',
              }),
            ],
          }),
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
  // `@serwist/next` auto-globs everything under public/ (incl. offline.html) into
  // __SW_MANIFEST with a file-hash revision, so the offline shell is already
  // precached and available to PrecacheFallbackPlugin (wired via `fallbacks` below).
  // Don't append it manually — a second /offline.html entry with a different
  // revision makes Serwist throw add-to-cache-list-conflicting-entries, the SW
  // never installs, and push notifications break.
  precacheEntries: self.__SW_MANIFEST ?? [],
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
  // Offline fallback for document navigations with no cached entry (e.g. a route
  // never visited before going offline). Only navigations match, so API/asset
  // handlers are unaffected.
  fallbacks: {
    entries: [
      {
        url: '/offline.html',
        matcher: ({ request }) => request.mode === 'navigate',
      },
    ],
  },
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

// Push notification handler. Every push MUST end in showNotification: iOS
// counts a push that displays nothing as a "silent push" and silently revokes
// the subscription after three strikes, so a missing or unparseable payload
// falls back to a generic notification instead of returning early.
self.addEventListener('push', (event) => {
  let data: {
    body?: string;
    tag?: string;
    url?: string;
    title?: string;
    actions?: { action: string; title: string }[];
    data?: Record<string, unknown>;
  } = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (error) {
      logToClients('error', 'Service worker push payload parse failed', { error: String(error) });
    }
  }
  const options: NotificationOptions = {
    body: data.body ?? 'You have a new notification — open Helprr to see it.',
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

// Some user agents (notably iOS) periodically rotate the push subscription
// endpoint. Without handling pushsubscriptionchange the old endpoint silently
// dies: the server keeps sending to a dead endpoint and a later manual
// re-subscribe creates a duplicate "device". Re-subscribe with the same VAPID key
// and hand the server BOTH endpoints so it migrates the existing row in place
// (preserving this device's per-event notification preferences).
// The key is runtime config served by the app (session cookie authenticates the
// fetch), so rotation keeps working after the server's key pair changes.
async function fetchVapidPublicKey(): Promise<string | null> {
  try {
    const res = await fetch('/api/push/public-key', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const data = await res.json();
    return data.publicKey ?? null;
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) output[i] = rawData.charCodeAt(i);
  return output;
}

async function rotateSubscription(event: {
  oldSubscription?: PushSubscription | null;
  newSubscription?: PushSubscription | null;
}): Promise<void> {
  try {
    const oldEndpoint = event.oldSubscription?.endpoint;
    let sub = event.newSubscription ?? null;
    if (!sub) {
      let applicationServerKey =
        event.oldSubscription?.options?.applicationServerKey ?? undefined;
      if (!applicationServerKey) {
        const key = await fetchVapidPublicKey();
        if (key) applicationServerKey = urlBase64ToUint8Array(key).buffer as ArrayBuffer;
      }
      if (!applicationServerKey) return;
      sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    }
    const json = sub.toJSON();
    if (!json.keys?.p256dh || !json.keys?.auth) return;
    await fetch('/api/push/subscribe', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: sub.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        oldEndpoint,
      }),
    });
  } catch (error) {
    logToClients('error', 'Service worker pushsubscriptionchange failed', { error: String(error) });
  }
}

self.addEventListener('pushsubscriptionchange', (event) => {
  const e = event as ExtendableEvent & {
    oldSubscription?: PushSubscription | null;
    newSubscription?: PushSubscription | null;
  };
  e.waitUntil(rotateSubscription(e));
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

function isSameOrigin(clientUrl: string): boolean {
  try {
    return new URL(clientUrl).origin === self.location.origin;
  } catch {
    return false;
  }
}

function focusOrOpen(url: string): Promise<unknown> {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if (isSameOrigin(client.url) && 'focus' in client) {
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

// Clear user-scoped caches on logout so the next person to sign in on this
// installed PWA never sees the previous user's cached shell or read data. Asset
// caches (static/image/font) are user-agnostic and intentionally kept.
// api-images holds auth-gated posters, so it's user-scoped too.
const USER_SCOPED_CACHES = ['pages', 'api-readonly', 'api-images'];
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | undefined)?.type === 'helprr-clear-user-caches') {
    event.waitUntil(
      Promise.all(USER_SCOPED_CACHES.map((name) => caches.delete(name)))
        .then(() => logToClients('info', 'Cleared user-scoped caches on logout'))
        .catch((error) => logToClients('error', 'Cache clear failed', { error: String(error) }))
    );
  }
});

serwist.addEventListeners();
