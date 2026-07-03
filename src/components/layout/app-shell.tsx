'use client';

import { useEffect } from 'react';
import { BottomNav } from '@/components/layout/bottom-nav';
import { PushReenableBanner } from '@/components/notifications/push-reenable-banner';
import { useUIStore } from '@/lib/store';
import { cn } from '@/lib/utils';

export function AppShell({ children }: { children: React.ReactNode }) {
  const navPosition = useUIStore((s) => s.navPosition);

  useEffect(() => {
    document.documentElement.dataset.navPosition = navPosition;
  }, [navPosition]);

  const isBottom = navPosition === 'bottom';

  return (
    <div className="flex-1 flex flex-col min-h-screen min-w-0">
      {!isBottom && <BottomNav />}
      {isBottom && (
        // With the nav at the bottom nothing occupies the status-bar strip, so
        // cover it — sticky toolbars pin at top = env(safe-area-inset-top) and
        // content would otherwise scroll behind the clock.
        <div
          aria-hidden
          className="md:hidden pointer-events-none fixed inset-x-0 top-0 z-40 h-[env(safe-area-inset-top)] app-chrome-bar bg-background/95 backdrop-blur-sm"
        />
      )}
      <main
        className={cn(
          'app-main flex-1 [overflow-x:clip]',
          isBottom ? 'pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-4' : 'pb-4'
        )}
      >
        <PushReenableBanner />
        {children}
      </main>
      {isBottom && <BottomNav />}
    </div>
  );
}
