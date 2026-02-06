'use client';

import { useState, useEffect, useCallback } from 'react';

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

/**
 * Ensure a service worker is registered (Serwist may be disabled in dev mode).
 * Returns the active registration or null.
 */
async function ensureServiceWorkerRegistration(timeoutMs = 5000): Promise<ServiceWorkerRegistration | null> {
  let registration = await navigator.serviceWorker.getRegistration();
  if (registration) return registration;

  // Serwist is disabled in dev — register the pre-built sw.js manually
  try {
    registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    return null;
  }

  // Wait for the SW to become active (with timeout)
  if (registration.active) return registration;

  return new Promise<ServiceWorkerRegistration | null>((resolve) => {
    const timeout = setTimeout(() => resolve(null), timeoutMs);
    const sw = registration!.installing || registration!.waiting;
    if (!sw) {
      clearTimeout(timeout);
      resolve(null);
      return;
    }
    sw.addEventListener('statechange', () => {
      if (sw.state === 'activated') {
        clearTimeout(timeout);
        resolve(registration!);
      }
    });
  });
}

export function usePushNotifications() {
  const isBrowser = typeof window !== 'undefined';
  const supported = isBrowser && 'serviceWorker' in navigator && 'PushManager' in window;
  const standalone = isBrowser && (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );

  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(supported);
  const [subscriptionEndpoint, setSubscriptionEndpoint] = useState<string | null>(null);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;

    (async () => {
      try {
        const registration = await ensureServiceWorkerRegistration();
        if (cancelled) return;
        if (!registration) {
          setLoading(false);
          return;
        }
        const sub = await registration.pushManager.getSubscription();
        console.log("sub", sub)
        if (cancelled) return;
        setIsSubscribed(!!sub);
        setSubscriptionEndpoint(sub?.endpoint || null);
      } catch { }
      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; }; 
  }, [supported]);

  const subscribe = useCallback(async () => {
    setLoading(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setLoading(false);
        return false;
      }

      // Ensure SW is registered (handles Serwist disabled in dev)
      const registration = await ensureServiceWorkerRegistration();
      if (!registration) {
        console.error('[Helprr] No service worker available for push notifications');
        setLoading(false);
        return false;
      }

      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        setLoading(false);
        return false;
      }

      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer,
      });

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

      if (!res.ok) {
        // Server failed to save subscription, unsubscribe the push manager
        await sub.unsubscribe();
        setLoading(false);
        return false;
      }

      setIsSubscribed(true);
      setSubscriptionEndpoint(sub.endpoint);
      setLoading(false);
      return true;
    } catch {
      setLoading(false);
      return false;
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    setLoading(true);
    try {
      const registration = await navigator.serviceWorker.ready;
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
    } catch { }
    setLoading(false);
  }, []);

  return { isSupported: supported, isSubscribed, isStandalone: standalone, subscribe, unsubscribe, loading, subscriptionEndpoint };
}
