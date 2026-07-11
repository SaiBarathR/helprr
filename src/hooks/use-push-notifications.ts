'use client';

import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import { useIsStandalone } from '@/hooks/use-is-standalone';

const PUSH_ENABLED_FLAG = 'helprr-push-enabled';

function setPushEnabledFlag(on: boolean): void {
  try {
    if (on) localStorage.setItem(PUSH_ENABLED_FLAG, '1');
    else localStorage.removeItem(PUSH_ENABLED_FLAG);
  } catch {
    /* localStorage unavailable — ignore */
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function appServerKeyMatches(existing: ArrayBuffer | null, expected: Uint8Array): boolean {
  if (!existing) return false;
  const bytes = new Uint8Array(existing);
  if (bytes.length !== expected.length) return false;
  return bytes.every((b, i) => b === expected[i]);
}

function waitForServiceWorker(timeoutMs = 10000): Promise<ServiceWorkerRegistration> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Service worker registration timed out'));
    }, timeoutMs);

    navigator.serviceWorker.ready.then((reg) => {
      clearTimeout(timer);
      resolve(reg);
    });
  });
}

async function registerWithServer(sub: PushSubscription): Promise<boolean> {
  const json = sub.toJSON();
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: sub.endpoint,
      keys: {
        p256dh: json.keys?.p256dh,
        auth: json.keys?.auth,
      },
    }),
  });
  return res.ok;
}

// Environment facts that never change within a session — read them as external
// stores (server snapshot: unsupported/null) instead of setState-on-mount.
const emptySubscribe = () => () => {};
const getIsSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
// Re-read on every render: requestPermission() flows always re-render (loading /
// subscribed state changes), so a fresh grant/deny surfaces immediately.
const getPermission = (): NotificationPermission | null =>
  'Notification' in window ? Notification.permission : null;

export function usePushNotifications() {
  const isSupported = useSyncExternalStore(emptySubscribe, getIsSupported, () => false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const isStandalone = useIsStandalone();
  const [checking, setLoading] = useState(true);
  // Unsupported browsers have nothing to check — resolve loading immediately.
  const loading = isSupported && checking;
  const [error, setError] = useState<string | null>(null);
  const [subscriptionEndpoint, setSubscriptionEndpoint] = useState<string | null>(null);
  const [wasReregistered, setWasReregistered] = useState(false);
  // Tracks whether THIS device ever had push turned on (localStorage), so we can
  // tell "never enabled" apart from "was enabled but iOS/permission dropped it".
  const [previouslyEnabled, setPreviouslyEnabled] = useState(() => {
    try {
      return typeof window !== 'undefined' && localStorage.getItem(PUSH_ENABLED_FLAG) === '1';
    } catch {
      return false; // localStorage unavailable (private mode) — banner just won't fire
    }
  });
  const permission = useSyncExternalStore(emptySubscribe, getPermission, () => null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reconcileSubscription = useCallback(async (sub: PushSubscription): Promise<{ done: boolean; revoked?: boolean }> => {
    const res = await fetch('/api/notifications/subscription/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    if (!res.ok) return { done: false };
    const data = (await res.json()) as { exists?: boolean; revoked?: boolean };
    if (data.revoked) {
      try {
        await sub.unsubscribe();
      } catch (err) {
        console.warn('[Push] could not unsubscribe revoked browser subscription:', err);
      }
      return { done: true, revoked: true };
    }
    if (data.exists === false) {
      const reregistered = await registerWithServer(sub);
      if (reregistered) setWasReregistered(true);
    }
    return { done: true };
  }, []);

  const checkSubscription = useCallback(async () => {
    try {
      const registration = await waitForServiceWorker();
      const sub = await registration.pushManager.getSubscription();
      if (!sub) {
        setIsSubscribed(false);
        setSubscriptionEndpoint(null);
        setLoading(false);
        return;
      }

      // The browser still holds the subscription, but the server may have
      // pruned it (consecutiveFailures cleanup, manual wipe, or a 410). Ask
      // the server whether the row still exists and silently re-register if
      // not — otherwise the toggle keeps showing "enabled" while no pushes
      // ever land. Retry once after 5s on transient failure so a brief
      // network hiccup doesn't leave the toggle "enabled" but pushes silent.
      const scheduleRetry = () => {
        retryTimerRef.current = setTimeout(() => {
          void reconcileSubscription(sub)
            .then((result) => {
              // Apply the retry's outcome: if the server says the subscription
              // was revoked, reflect it in the UI (reconcileSubscription already
              // unsubscribed the browser) instead of keeping "enabled" shown.
              if (result.done && result.revoked) {
                setIsSubscribed(false);
                setSubscriptionEndpoint(null);
              }
            })
            .catch((err) => {
              console.warn('[Push] subscription check retry failed:', err);
            });
        }, 5000);
      };
      let revoked = false;
      try {
        const result = await reconcileSubscription(sub);
        if (!result.done) scheduleRetry();
        else if (result.revoked) revoked = true;
      } catch (err) {
        console.warn('[Push] subscription check failed:', err);
        scheduleRetry();
      }

      if (revoked) {
        setIsSubscribed(false);
        setSubscriptionEndpoint(null);
      } else {
        setIsSubscribed(true);
        setSubscriptionEndpoint(sub.endpoint);
        // An active subscription means this device is opted in — remember it so a
        // later silent drop (iOS revoking permission) surfaces the re-enable nudge.
        setPreviouslyEnabled(true);
        setPushEnabledFlag(true);
      }
    } catch (err) {
      console.warn('[Push] Could not check subscription:', err);
    }
    setLoading(false);
  }, [reconcileSubscription]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- checkSubscription only sets state after await points (async SW/server reconcile), never synchronously; the rule can't see the async boundary
    if (isSupported) checkSubscription();
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [isSupported, checkSubscription]);

  const subscribe = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    setLoading(true);
    setError(null);

    try {
      // 1. Fetch the VAPID key (runtime config — not baked into the bundle, so
      // one prebuilt image serves every install's own key)
      let vapidKey: string | null = null;
      try {
        const res = await fetch('/api/push/public-key');
        if (res.ok) vapidKey = (await res.json()).publicKey ?? null;
      } catch {
        // fall through to the not-configured error
      }
      if (!vapidKey) {
        const msg = 'VAPID public key not configured on the server. Set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT.';
        setError(msg);
        setLoading(false);
        return { success: false, error: msg };
      }

      // 2. Request notification permission
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        const msg = permission === 'denied'
          ? 'Notification permission denied. Please enable it in your browser settings.'
          : 'Notification permission was dismissed.';
        setError(msg);
        setLoading(false);
        return { success: false, error: msg };
      }

      // 3. Wait for service worker
      let registration: ServiceWorkerRegistration;
      try {
        registration = await waitForServiceWorker();
      } catch {
        const msg = 'Service worker not available. Try refreshing the page.';
        setError(msg);
        setLoading(false);
        return { success: false, error: msg };
      }

      // 4. Subscribe to push. If the browser still holds a subscription made
      // under a different applicationServerKey (server VAPID keys rotated),
      // subscribe() throws InvalidStateError forever — drop the stale one first.
      const appServerKey = urlBase64ToUint8Array(vapidKey);
      const existing = await registration.pushManager.getSubscription();
      if (existing && !appServerKeyMatches(existing.options.applicationServerKey, appServerKey)) {
        await existing.unsubscribe();
      }
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey.buffer as ArrayBuffer,
      });

      // 5. Send subscription to server
      const ok = await registerWithServer(sub);
      if (!ok) {
        const msg = 'Failed to save subscription on server.';
        setError(msg);
        setLoading(false);
        return { success: false, error: msg };
      }

      setIsSubscribed(true);
      setSubscriptionEndpoint(sub.endpoint);
      setWasReregistered(false);
      setPreviouslyEnabled(true);
      setPushEnabledFlag(true);
      setLoading(false);
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to enable notifications.';
      setError(msg);
      setLoading(false);
      return { success: false, error: msg };
    }
  }, []);

  const unsubscribe = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    setLoading(true);
    setError(null);
    try {
      const registration = await waitForServiceWorker();
      const sub = await registration.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
      }
      setIsSubscribed(false);
      setSubscriptionEndpoint(null);
      setWasReregistered(false);
      // Explicit opt-out: clear the flag so we don't nag them to re-enable.
      setPreviouslyEnabled(false);
      setPushEnabledFlag(false);
      setLoading(false);
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to disable notifications.';
      setError(msg);
      setLoading(false);
      return { success: false, error: msg };
    }
  }, []);

  const dismissReregisteredNotice = useCallback(() => setWasReregistered(false), []);

  // This device opted in before but is no longer subscribed (iOS dropped the
  // permission/subscription, or the server pruned it and the browser sub is
  // gone). permissionDenied distinguishes "tap to re-enable" from "must re-allow
  // in OS settings" — once denied, the browser won't show the prompt again.
  const permissionDenied = permission === 'denied';
  const needsReenable = isSupported && !loading && previouslyEnabled && !isSubscribed;

  return {
    isSupported,
    isSubscribed,
    isStandalone,
    subscribe,
    unsubscribe,
    loading,
    error,
    subscriptionEndpoint,
    wasReregistered,
    dismissReregisteredNotice,
    needsReenable,
    permissionDenied,
  };
}
