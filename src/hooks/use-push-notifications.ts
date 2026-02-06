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

export function usePushNotifications() {
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subscriptionEndpoint, setSubscriptionEndpoint] = useState<string | null>(null);

  useEffect(() => {
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setIsSupported(supported);
    setIsStandalone(
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    );

    if (supported) {
      checkSubscription();
    } else {
      setLoading(false);
    }
  }, []);

  async function checkSubscription() {
    try {
      const registration = await waitForServiceWorker();
      const sub = await registration.pushManager.getSubscription();
      setIsSubscribed(!!sub);
      setSubscriptionEndpoint(sub?.endpoint || null);
    } catch (err) {
      console.warn('[Push] Could not check subscription:', err);
    }
    setLoading(false);
  }

  const subscribe = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    setLoading(true);
    setError(null);

    try {
      // 1. Check VAPID key
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        const msg = 'VAPID public key not configured. Check your .env file.';
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

      // 4. Subscribe to push
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer,
      });

      // 5. Send subscription to server
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
        const msg = 'Failed to save subscription on server.';
        setError(msg);
        setLoading(false);
        return { success: false, error: msg };
      }

      setIsSubscribed(true);
      setSubscriptionEndpoint(sub.endpoint);
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
      setLoading(false);
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to disable notifications.';
      setError(msg);
      setLoading(false);
      return { success: false, error: msg };
    }
  }, []);

  return { isSupported, isSubscribed, isStandalone, subscribe, unsubscribe, loading, error, subscriptionEndpoint };
}
