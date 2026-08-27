'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Clapperboard, Heart, LayoutGrid, Radio, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/jellyfin/library', label: 'Home', icon: Clapperboard, match: (path: string) => path === '/jellyfin/library' },
  { href: '/jellyfin/library/favorites', label: 'Favorites', icon: Heart, match: (path: string) => path.startsWith('/jellyfin/library/favorites') },
  { href: '/jellyfin/library/browse/libraries', label: 'Browse', icon: LayoutGrid, match: (path: string) => path.startsWith('/jellyfin/library/browse') },
  { href: '/jellyfin/library/live', label: 'Live TV', icon: Radio, match: (path: string) => path.startsWith('/jellyfin/library/live') },
  { href: '/jellyfin/library/search', label: 'Search', icon: Search, match: (path: string) => path.startsWith('/jellyfin/library/search') },
] as const;

export function WatchSubNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Watch sections" className="inline-flex items-center gap-0.5 rounded-lg border border-border p-0.5 app-chrome-bar bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      {ITEMS.map(({ href, label, icon: Icon, match }) => {
        const isActive = match(pathname);
        return (
          <Link
            key={href}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors sm:px-3',
              isActive
                ? 'bg-[var(--hpr-amber)] text-[var(--hpr-ink)] shadow-sm'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className="hidden sm:inline">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
