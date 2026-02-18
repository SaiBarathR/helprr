'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  Film, Tv, CalendarDays, Activity, MoreHorizontal,
  LayoutDashboard, HardDrive, Bell, Settings, Search,
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

const tabs = [
  { href: '/movies', icon: Film, label: 'Movies' },
  { href: '/series', icon: Tv, label: 'Series' },
  { href: '/calendar', icon: CalendarDays, label: 'Calendar' },
  { href: '/activity', icon: Activity, label: 'Activity' },
];

const moreItems = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/torrents', icon: HardDrive, label: 'Torrents' },
  { href: '/prowlarr', icon: Search, label: 'Prowlarr' },
  { href: '/notifications', icon: Bell, label: 'Notifications' },
  { href: '/settings', icon: Settings, label: 'Settings' },
];

export function BottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const isMoreActive = moreItems.some(
    (item) => pathname === item.href || pathname.startsWith(item.href + '/')
  );

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around h-12">
        {tabs.map(({ href, icon: Icon, label }) => {
          const isActive = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 flex-1 h-full min-h-[48px] text-[10px] font-medium transition-colors',
                isActive ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} />
              {label}
            </Link>
          );
        })}

        {/* More button */}
        <Popover open={moreOpen} onOpenChange={setMoreOpen}>
          <PopoverTrigger asChild>
            <button
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 flex-1 h-full min-h-[48px] text-[10px] font-medium transition-colors',
                isMoreActive ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              <MoreHorizontal className="h-5 w-5" strokeWidth={isMoreActive ? 2.5 : 2} />
              More
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="end"
            sideOffset={8}
            className="w-56 p-2"
          >
            <div className="space-y-0.5">
              {moreItems.map(({ href, icon: Icon, label }) => {
                const isActive = pathname === href || pathname.startsWith(href + '/');
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors min-h-[44px]',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-foreground hover:bg-accent'
                    )}
                  >
                    <Icon className="h-5 w-5 shrink-0" />
                    {label}
                  </Link>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </nav>
  );
}
