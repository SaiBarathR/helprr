'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { NAV_ITEMS } from '@/lib/nav-config';
import { Skeleton } from '@/components/ui/skeleton';

export function NavigationLoading({ href }: { href: string }) {
  const [slow, setSlow] = useState(false);
  const path = href.split('?')[0];
  const section = [...NAV_ITEMS].reverse().find((item) => path === item.href || path.startsWith(item.href + '/'));
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="p-4 md:p-6 space-y-6" role="status" aria-live="polite" aria-busy="true" data-navigation-loading>
      <div className="flex items-center gap-3">
        <Loader2 className="size-5 animate-spin text-primary" />
        <h1 className="text-xl font-semibold">{section?.label ?? 'Loading page'}</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        {slow ? 'Still loading. You can choose another page while you wait.' : 'Loading…'}
      </p>
      <div className="space-y-4" aria-hidden="true">
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    </div>
  );
}
