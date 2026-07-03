// Lightweight service worker for development - push notifications only, no precaching.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function logToClients(level, message, metadata) {
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
async function updateAppBadge() {
  if (!self.navigator || !self.navigator.setAppBadge) return;
  // Bound the fetch so a hanging request can't keep the push handler (and thus
  // the service worker) alive via waitUntil.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch('/api/badges', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
    if (!res.ok) {
      // Session expired — clear the stale icon badge instead of leaving it.
      if ((res.status === 401 || res.status === 403) && self.navigator.clearAppBadge) {
        await self.navigator.clearAppBadge();
      }
      return;
    }
    const data = await res.json();
    const count = (data && data.notifications && data.notifications.total) || 0;
    if (count > 0) await self.navigator.setAppBadge(count);
    else if (self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
  } catch (error) {
    logToClients('error', 'Service worker app-badge update failed', { error: String(error) });
  } finally {
    clearTimeout(timeout);
  }
}

// Every push MUST end in showNotification: iOS counts a push that displays
// nothing as a "silent push" and silently revokes the subscription after three
// strikes, so a missing or unparseable payload falls back to a generic
// notification instead of returning early.
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (error) {
      logToClients('error', 'Service worker push payload parse failed', { error: String(error) });
    }
  }
  const options = {
    body: data.body || 'You have a new notification — open Helprr to see it.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'helprr-notification',
    // Action buttons render on Android/desktop; iOS ignores them and falls back
    // to tapping the body (which deep-links to the relevant action view).
    data: { url: data.url || '/notifications', ...(data.data || {}) },
    ...(data.actions ? { actions: data.actions } : {}),
  };
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || 'Helprr', options),
      updateAppBadge(),
    ])
  );
});

// Mirror the production worker: handle endpoint rotation (iOS rotates the push
// endpoint) so dev/testing doesn't silently lose pushes or accumulate duplicate
// devices. Hand the server both endpoints so it migrates the row in place. No
// VAPID fallback here — this static file isn't webpack-processed, so the inlined
// key isn't available; we rely on the event's own subscription / old key.
async function rotateSubscription(event) {
  try {
    const oldEndpoint = event.oldSubscription && event.oldSubscription.endpoint;
    let sub = event.newSubscription || null;
    if (!sub) {
      const applicationServerKey =
        event.oldSubscription && event.oldSubscription.options && event.oldSubscription.options.applicationServerKey;
      if (!applicationServerKey) return;
      sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    }
    const json = sub.toJSON();
    if (!json.keys || !json.keys.p256dh || !json.keys.auth) return;
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
  event.waitUntil(rotateSubscription(event));
});

async function confirm(body, tag) {
  await self.registration.showNotification('Helprr', {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag,
  });
}

async function handleRequestAction(action, pendingId) {
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

async function handleRetryAction(data) {
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

self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {};
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

  const url = data.url || '/dashboard';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        let sameOrigin = false;
        try {
          sameOrigin = new URL(client.url).origin === self.location.origin;
        } catch {
          sameOrigin = false;
        }
        if (sameOrigin && 'focus' in client) {
          client.focus();
          client.navigate(url);
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
