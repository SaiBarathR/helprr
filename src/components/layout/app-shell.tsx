'use client';

import { useEffect } from 'react';
import { BottomNav } from '@/components/layout/bottom-nav';
import { useUIStore } from '@/lib/store';
import { cn } from '@/lib/utils';

export function AppShell({ children }: { children: React.ReactNode }) {
  const navPosition = useUIStore((s) => s.navPosition);

  useEffect(() => {
    document.documentElement.dataset.navPosition = navPosition;
  }, [navPosition]);

  const isBottom = navPosition === 'bottom';

  return (
    <div className="relative flex-1 flex flex-col min-h-screen min-w-0">
      {/* Ambient projector wash + grain — fixed background atmosphere */}
      <div className="lens-flare" aria-hidden />
      <div className="ambient-grain" aria-hidden />

      {!isBottom && <BottomNav />}
      <main
        className={cn(
          'relative z-[1] flex-1 px-3 md:px-8 [overflow-x:clip]',
          isBottom
            ? 'pt-3 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-6'
            : 'pt-3 pb-6'
        )}
        style={
          isBottom
            ? { paddingTop: 'max(0.75rem, env(safe-area-inset-top, 0.75rem))' }
            : undefined
        }
      >
        {children}
      </main>
      {isBottom && <BottomNav />}
    </div>
  );
}
