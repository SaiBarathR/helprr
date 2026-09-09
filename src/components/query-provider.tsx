'use client';

import { useEffect, useRef, useState } from 'react';
import { BrowseFreshnessNotice } from '@/components/browse-freshness-notice';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { refreshAfterReconnect } from '@/lib/reconnect-queries';
import { getQueryClient } from '@/lib/query-client';
import {
  clearUserScopedBrowserCaches,
  subscribeToAuthenticationBoundaries,
} from '@/lib/client-cache';
import { invalidateExternalUrls } from '@/lib/hooks/use-external-urls';
import { invalidateNotificationSubscriptions } from '@/lib/notification-subscription-cache';
import {
  isNotificationSubscriptionsChangedMessage,
  NOTIFICATION_SUBSCRIPTIONS_CHANGED,
} from '@/lib/notification-subscriptions';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // Singleton on the client (see getQueryClient); safe to call during render.
  const queryClient = getQueryClient();
  const [authenticationBoundaryActive, setAuthenticationBoundaryActive] = useState(false);
  const [authenticationBoundaryError, setAuthenticationBoundaryError] = useState(false);
  const boundaryClearStarted = useRef(false);
  useEffect(() => {
    let controller: AbortController | null = null;
    let pending = false;
    const refresh = () => {
      if (!navigator.onLine || document.visibilityState === 'hidden') return;
      controller?.abort();
      controller = new AbortController();
      pending = false;
      void refreshAfterReconnect(queryClient, window.location.pathname, controller.signal);
    };
    const online = () => { pending = true; refresh(); };
    const visible = () => { if (pending) refresh(); };
    const offline = () => controller?.abort();
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', visible);
    return () => {
      controller?.abort();
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [queryClient]);
  useEffect(() => {
    let handlingBoundary = false;
    return subscribeToAuthenticationBoundaries(() => {
      if (handlingBoundary) return;
      handlingBoundary = true;
      // Blank mounted state synchronously with the boundary notification. A
      // reload is safe only after this realm confirms its persistent caches are
      // gone; otherwise the service worker could replay the prior identity.
      setAuthenticationBoundaryActive(true);
      queryClient.clear();
      invalidateExternalUrls();
    });
  }, [queryClient]);
  useEffect(() => {
    const serviceWorker = navigator.serviceWorker;
    if (!serviceWorker) return;
    const onMessage = (event: MessageEvent<unknown>) => {
      if (isNotificationSubscriptionsChangedMessage(event.data)) {
        void invalidateNotificationSubscriptions(queryClient);
        window.dispatchEvent(new Event(NOTIFICATION_SUBSCRIPTIONS_CHANGED));
      }
    };
    serviceWorker.addEventListener('message', onMessage);
    return () => serviceWorker.removeEventListener('message', onMessage);
  }, [queryClient]);
  useEffect(() => {
    if (!authenticationBoundaryActive || boundaryClearStarted.current) return;
    boundaryClearStarted.current = true;
    // Effects run only after React commits the neutral boundary screen, so no
    // cached reload can race ahead of unmounting the authenticated tree.
    void clearUserScopedBrowserCaches()
      .then(() => window.location.reload())
      .catch(() => setAuthenticationBoundaryError(true));
  }, [authenticationBoundaryActive]);

  if (authenticationBoundaryActive) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background p-6">
        <p className="max-w-md text-center text-sm text-muted-foreground" role="status">
          {authenticationBoundaryError
            ? 'Browser data could not be cleared. Clear this site’s browser data, then reload.'
            : 'Securing this browser session…'}
        </p>
      </main>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowseFreshnessNotice onRetry={() => void queryClient.invalidateQueries({ refetchType: 'active' })} />
      {children}
      {/* Away from bottom-right, where the toggle sat directly on top of the
          expanded player's Player settings button and swallowed taps meant for
          it — the player owns bottom-left (transport), bottom-right (subtitles
          through settings) and top-left (minimize/close), and Next's own dev
          badge takes bottom-left, so top-right is the corner left over. */}
      {process.env.NODE_ENV === 'development' && (
        <ReactQueryDevtools initialIsOpen={false} buttonPosition="top-right" />
      )}
    </QueryClientProvider>
  );
}
