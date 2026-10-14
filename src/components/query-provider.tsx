'use client';

import { useEffect, useRef, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { refreshAfterReconnect } from '@/lib/reconnect-queries';
import { getQueryClient, holdLoginRedirect } from '@/lib/query-client';
import {
  clearUserScopedBrowserCaches,
  subscribeToAuthenticationBoundaries,
  subscribeToSessionEnd,
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
  // Where to go once the caches are clear: reload when another tab's session
  // changed, Login when this tab's own session ended.
  const [authenticationBoundary, setAuthenticationBoundary] = useState<'reload' | 'login' | null>(null);
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
    const begin = (destination: 'reload' | 'login') => {
      if (handlingBoundary) return;
      handlingBoundary = true;
      // Queries that refetch with the dead cookie must not jump to Login
      // while the caches below are still being cleared.
      holdLoginRedirect();
      // Blank mounted state synchronously with the boundary notification. A
      // reload is safe only after this realm confirms its persistent caches are
      // gone; otherwise the service worker could replay the prior identity.
      setAuthenticationBoundary(destination);
      queryClient.clear();
      invalidateExternalUrls();
    };
    const unsubscribeOtherTabs = subscribeToAuthenticationBoundaries(() => begin('reload'));
    const unsubscribeThisTab = subscribeToSessionEnd(() => begin('login'));
    return () => {
      unsubscribeOtherTabs();
      unsubscribeThisTab();
    };
  }, [queryClient]);
  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (isNotificationSubscriptionsChangedMessage(event.data)) {
        void invalidateNotificationSubscriptions(queryClient);
        window.dispatchEvent(new Event(NOTIFICATION_SUBSCRIPTIONS_CHANGED));
      }
    };
    // Optional chaining, not `if (!serviceWorker) return`: Turbopack takes
    // `navigator.serviceWorker` to be always present and compiles that test
    // away under `npm run dev`. Over plain http on a LAN address there is no
    // such object, and the call below then threw on every signed-in page.
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, [queryClient]);
  useEffect(() => {
    if (!authenticationBoundary || boundaryClearStarted.current) return;
    boundaryClearStarted.current = true;
    // Effects run only after React commits the neutral boundary screen, so no
    // cached reload can race ahead of unmounting the authenticated tree.
    void clearUserScopedBrowserCaches()
      .then(() => {
        if (authenticationBoundary === 'login') window.location.replace('/login');
        else window.location.reload();
      })
      .catch(() => setAuthenticationBoundaryError(true));
  }, [authenticationBoundary]);

  if (authenticationBoundary) {
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
