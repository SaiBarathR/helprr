'use client';

import NextLink from 'next/link';
import { useRef, type ComponentProps } from 'react';
import { useAppRouter } from '@/components/layout/navigation-provider';
import { cn } from '@/lib/utils';

/** Content grids shouldn't prefetch a route for every poster over mobile data.
 * Primary navigation explicitly opts back into Next's partial prefetching. */
export default function AppLink({ ref, onNavigate, prefetch = false, className, ...props }: ComponentProps<typeof NextLink>) {
  const anchor = useRef<HTMLAnchorElement | null>(null);
  const router = useAppRouter();
  return (
    <NextLink
      {...props}
      className={cn('touch-manipulation active:opacity-70', className)}
      prefetch={prefetch}
      ref={(node) => {
        anchor.current = node;
        if (typeof ref === 'function') return ref(node);
        if (ref) ref.current = node;
      }}
      onNavigate={(event) => {
        let cancelled = false;
        onNavigate?.({ preventDefault: () => { cancelled = true; event.preventDefault(); } });
        if (cancelled || !anchor.current) return;
        // Next invokes onNavigate only for same-origin, unmodified navigation;
        // downloads, new tabs, external links and cancelled clicks stay native.
        event.preventDefault();
        const url = new URL(anchor.current.href);
        router[props.replace ? 'replace' : 'push'](url.pathname + url.search + url.hash, { scroll: props.scroll });
      }}
    />
  );
}
