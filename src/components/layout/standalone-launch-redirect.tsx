'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { resolveDefaultPageHref } from '@/lib/nav-config';
import { useUIStore } from '@/lib/store';

function detectStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;

  const iosStandalone = (
    window.navigator as Navigator & { standalone?: boolean }
  ).standalone === true;
  const mediaStandalone = window.matchMedia('(display-mode: standalone)').matches;

  return iosStandalone || mediaStandalone;
}

/**
 * Redirect old installed PWAs that still open at /dashboard to the configured default page.
 *
 * Runs once on initial app-shell load in standalone mode, so normal in-app navigation to
 * Dashboard is unaffected.
 */
export function StandaloneLaunchRedirect() {
  const router = useRouter();
  const pathname = usePathname();
  const navOrder = useUIStore((s) => s.navOrder);
  const disabledNavItems = useUIStore((s) => s.disabledNavItems);
  const defaultPage = useUIStore((s) => s.defaultPage);
  const hydrated = useUIStore((s) => s.hasHydrated);
  const standaloneMode = detectStandaloneMode();

  const hasCheckedInitialLaunch = useRef(false);

  useEffect(() => {
    if (hasCheckedInitialLaunch.current) return;
    if (!hydrated) return;

    hasCheckedInitialLaunch.current = true;

    if (!standaloneMode || pathname !== '/dashboard') return;

    const targetHref = resolveDefaultPageHref({
      defaultPage,
      navOrder,
      disabledNavItems,
    });

    if (targetHref !== '/dashboard') {
      router.replace(targetHref);
    }
  }, [defaultPage, disabledNavItems, hydrated, navOrder, pathname, router, standaloneMode]);

  return null;
}
