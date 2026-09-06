'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter as useNextRouter } from 'next/navigation';

type Router = ReturnType<typeof useNextRouter>;
type Destination = { pathname: string; href: string };

// Pending feedback must not re-render every card/link on a busy dashboard.
// Router consumers subscribe only to the stable action context.
const RouterContext = createContext<Router | null>(null);
const PendingHrefContext = createContext<string | null>(null);

/** Keep feedback in the already-downloaded shell, outside Next's route boundary. */
export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const nextRouter = useNextRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [destination, setDestination] = useState<Destination | null>(null);
  const [historyDestination, setHistoryDestination] = useState<{ from: string; href: string } | null>(null);
  const historyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onPopState = () => {
      if (historyTimer.current) clearTimeout(historyTimer.current);
      setHistoryDestination(window.location.pathname !== pathname
        ? { from: pathname, href: window.location.pathname + window.location.search }
        : null);
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      if (historyTimer.current) clearTimeout(historyTimer.current);
    };
  }, [pathname]);

  const navigate = useCallback((method: 'push' | 'replace', href: string, options?: Parameters<Router['push']>[1]) => {
    const url = new URL(href, window.location.href);
    setHistoryDestination(null);
    if (historyTimer.current) clearTimeout(historyTimer.current);
    // Filter/search/hash updates keep their current view and controls mounted.
    setDestination(url.origin === window.location.origin && url.pathname !== window.location.pathname
      ? { pathname: url.pathname, href: url.pathname + url.search }
      : null);
    startTransition(() => nextRouter[method](href, options));
  }, [nextRouter]);

  const traverseHistory = useCallback((method: 'back' | 'forward') => {
    setDestination(null);
    setHistoryDestination({ from: pathname, href: '' });
    if (historyTimer.current) clearTimeout(historyTimer.current);
    // At the edge of browser history there is no popstate event or navigation.
    // Once popstate arrives, only a route commit clears the loading view.
    historyTimer.current = setTimeout(() => setHistoryDestination(null), 1000);
    nextRouter[method]();
  }, [nextRouter, pathname]);

  const router = useMemo<Router>(() => ({
    ...nextRouter,
    push: (href, options) => navigate('push', href, options),
    replace: (href, options) => navigate('replace', href, options),
    back: () => traverseHistory('back'),
    forward: () => traverseHistory('forward'),
  }), [navigate, nextRouter, traverseHistory]);

  // A redirect, error or superseding navigation completes the transition too.
  // No arbitrary timeout that makes a slow, still-pending request look finished.
  const pendingHref = isPending && destination && pathname !== destination.pathname
    ? destination.href
    : historyDestination?.from === pathname ? historyDestination.href : null;
  return <RouterContext.Provider value={router}>
    <PendingHrefContext.Provider value={pendingHref}>{children}</PendingHrefContext.Provider>
  </RouterContext.Provider>;
}

export function useAppRouter(): Router {
  const native = useNextRouter();
  return useContext(RouterContext) ?? native;
}

export function usePendingHref(): string | null {
  return useContext(PendingHrefContext);
}
