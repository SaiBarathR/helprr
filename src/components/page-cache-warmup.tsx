'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { resolveDefaultPageHref } from '@/lib/nav-config';
import { warmPageCache } from '@/lib/page-warmup';
import { useUIStore } from '@/lib/store';

// Let the page's own data requests go first. Not cancelled by the next
// navigation: a page left quickly was still opened.
const WARMUP_DELAY_MS = 1_000;

function warmSoon(href: string): void {
  window.setTimeout(() => warmPageCache(href), WARMUP_DELAY_MS);
}

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

  useEffect(() => {
    if (!hydrated) return;
    warmSoon('/');
    warmSoon(resolveDefaultPageHref({ defaultPage, navOrder, disabledNavItems }));
  }, [defaultPage, disabledNavItems, hydrated, navOrder]);

  useEffect(() => {
    warmSoon(window.location.pathname + window.location.search);
  }, [pathname]);

  return null;
}
