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
    <div className="flex-1 flex flex-col min-h-screen min-w-0">
      {!isBottom && <BottomNav />}
      <main
        className={cn(
          'flex-1 px-4 md:p-6 [overflow-x:clip]',
          isBottom ? 'pt-2 pb-20 md:pb-4' : 'pt-2 pb-4'
        )}
        style={isBottom ? { paddingTop: 'max(0.5rem, env(safe-area-inset-top, 0.5rem))' } : undefined}
      >
        {children}
      </main>
      {isBottom && <BottomNav />}
    </div>
  );
}
