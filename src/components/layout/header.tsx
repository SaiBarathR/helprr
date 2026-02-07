'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Clapperboard } from 'lucide-react';

// Maps top-level routes to their display titles
const routeTitles: Record<string, string> = {
  '/movies': 'Movies',
  '/series': 'Series',
  '/calendar': 'Calendar',
  '/activity': 'Activity',
  '/dashboard': 'Dashboard',
  '/torrents': 'Torrents',
  '/notifications': 'Notifications',
  '/settings': 'Settings',
};

export function Header() {
  const pathname = usePathname();

  // On mobile, only show header for top-level pages (not detail pages)
  const isTopLevel = Object.keys(routeTitles).includes(pathname);
  const title = routeTitles[pathname];

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm pt-[env(safe-area-inset-top)]">
      <div className="flex items-center h-11 px-4">
        {/* Desktop: show logo */}
        <div className="hidden md:flex items-center gap-2">
          <Clapperboard className="h-5 w-5 text-primary" />
          <span className="font-semibold">Helprr</span>
        </div>

        {/* Mobile: show page title for top-level pages */}
        {isTopLevel && title ? (
          <h1 className="md:hidden text-lg font-bold">{title}</h1>
        ) : (
          <div className="md:hidden flex items-center gap-2">
            <Link href="/movies" className="flex items-center gap-2">
              <Clapperboard className="h-5 w-5 text-primary" />
              <span className="font-semibold">Helprr</span>
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
