import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A top-level page's visible title: the same large title the Settings pages use. It scrolls
 * away above the page's sticky toolbar. Its bottom margin is the page's top padding, which a
 * flush toolbar right after it pulls itself up by (.page-toolbar-flush), as under DemoBanner.
 */
export function PageTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h1 className={cn('mb-[var(--main-pad-top)] px-1 text-2xl font-semibold leading-tight', className)}>
      {children}
    </h1>
  );
}
