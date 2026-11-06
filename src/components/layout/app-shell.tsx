'use client';

import { useEffect, useRef } from 'react';
import { BottomNav } from '@/components/layout/bottom-nav';
import { PushReenableBanner } from '@/components/notifications/push-reenable-banner';
import { useUIStore } from '@/lib/store';
import { usePendingHref } from '@/components/layout/navigation-provider';
import { NavigationLoading } from '@/components/layout/navigation-loading';
import { BrowseFreshnessNotice } from '@/components/browse-freshness-notice';
import { getQueryClient } from '@/lib/query-client';
import { RouteScrollRestoration } from '@/components/layout/route-scroll-restoration';
import { DemoBanner } from '@/components/layout/demo-banner';

export function AppShell({ children, demo = false }: { children: React.ReactNode; demo?: boolean }) {
  const mainRef = useRef<HTMLElement>(null);
  const pendingHref = usePendingHref();
  const navPosition = useUIStore((s) => s.navPosition);
  const hasHydrated = useUIStore((s) => s.hasHydrated);
  const watchSkin = useUIStore((s) => s.watchSkin);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    // On the root, not <main>: the now-playing bar lives outside <main> and
    // starts here so it doesn't cover the sidebar.
    const root = document.documentElement;
    const measure = () => root.style.setProperty('--app-main-left', `${main.getBoundingClientRect().left}px`);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(main);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  // Waits for the saved prefs: the hydration render uses the store defaults,
  // and stamping those would undo the pre-paint script's stamp for a frame.
  useEffect(() => {
    if (!hasHydrated) return;
    document.documentElement.dataset.navPosition = navPosition;
  }, [hasHydrated, navPosition]);

  // Mirrors THEME_BOOTSTRAP_SCRIPT's pre-paint stamp so the skin follows the
  // store after hydration (toggling in Settings takes effect immediately).
  useEffect(() => {
    document.documentElement.dataset.watchSkin = watchSkin;
  }, [watchSkin]);

  return (
    <div className="flex-1 flex flex-col min-h-screen min-w-0">
      {/* Rendered once for both positions and placed by globals.css from
          <html data-nav-position>, which the pre-paint script stamps from the
          saved prefs. The server renders with the store defaults, so choosing
          the position here would paint the bar on the wrong edge until hydration. */}
      <BottomNav />
      {/* With the nav at the bottom nothing occupies the status-bar strip, so
          this covers it (shown by globals.css) — sticky toolbars pin at
          top = env(safe-area-inset-top) and content would otherwise scroll
          behind the clock. */}
      <div
        aria-hidden
        className="app-status-scrim pointer-events-none fixed inset-x-0 top-0 z-40 h-[env(safe-area-inset-top)] app-chrome-bar bg-background/95 backdrop-blur-sm"
      />
      <main
        ref={mainRef}
        // The skip link's target (src/components/layout/skip-link.tsx).
        id="main"
        // Clear the bottom tab bar and the home indicator (--footer-height).
        className="app-main flex-1 [overflow-x:clip] pb-[calc(var(--footer-height)+1rem)] outline-none"
      >
        <BrowseFreshnessNotice onRetry={() => void getQueryClient().invalidateQueries({ refetchType: 'active' })} />
        {demo && <DemoBanner />}
        <PushReenableBanner />
        {pendingHref !== null && (
          <div className="fixed right-0 bottom-0 top-[env(safe-area-inset-top)] z-30 overflow-y-auto bg-background" style={{ left: 'var(--app-main-left, 0px)' }}>
            <NavigationLoading key={pendingHref} href={pendingHref} />
          </div>
        )}
        <RouteScrollRestoration pending={pendingHref !== null}>{children}</RouteScrollRestoration>
      </main>
    </div>
  );
}
