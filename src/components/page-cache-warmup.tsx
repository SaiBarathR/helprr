'use client';

import { useCallback, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { subscribeToSessionEnd } from '@/lib/client-cache';
import { resolveDefaultPageHref } from '@/lib/nav-config';
import { warmPageCache } from '@/lib/page-warmup';
import { useUIStore } from '@/lib/store';

// Let the page's own data requests go first. Not cancelled by the next
// navigation: a page left quickly was still opened.
const WARMUP_DELAY_MS = 1_000;

/**
 * Keeps every page opened in the app available offline from a cold start
 * (see `page-warmup.ts`), plus the way in: the installed app launches on `/`,
 * which redirects to the default page, and offline.html has no way into the
 * app, so both are kept even when this session started on a deeper page.
 */
export function PageCacheWarmup() {
  const pathname = usePathname();
  const navOrder = useUIStore((s) => s.navOrder);
  const disabledNavItems = useUIStore((s) => s.disabledNavItems);
  const defaultPage = useUIStore((s) => s.defaultPage);
  const hydrated = useUIStore((s) => s.hasHydrated);
  const timers = useRef(new Set<number>());
  const ended = useRef(false);

  // Nothing pending outlives the shell, or the session it was scheduled for.
  useEffect(() => {
    const pending = timers.current;
    const cancelAll = () => {
      for (const timer of pending) window.clearTimeout(timer);
      pending.clear();
    };
    const unsubscribe = subscribeToSessionEnd(() => {
      ended.current = true;
      cancelAll();
    });
    return () => {
      unsubscribe();
      cancelAll();
    };
  }, []);

  const warmSoon = useCallback((href: string) => {
    if (ended.current) return;
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      warmPageCache(href);
    }, WARMUP_DELAY_MS);
    timers.current.add(timer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    warmSoon('/');
    warmSoon(resolveDefaultPageHref({ defaultPage, navOrder, disabledNavItems }));
  }, [defaultPage, disabledNavItems, hydrated, navOrder, warmSoon]);

  useEffect(() => {
    warmSoon(window.location.pathname + window.location.search);
  }, [pathname, warmSoon]);

  return null;
}
