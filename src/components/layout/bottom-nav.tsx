'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Loader2, MoreHorizontal } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useUIStore } from '@/lib/store';
import { getEnabledNavItems, getBottomNavLayout } from '@/lib/nav-config';
import { useNavPending } from '@/hooks/use-nav-pending';

/**
 * Render a responsive bottom navigation bar with primary tabs and an optional "More" popover.
 *
 * The navigation derives visible tabs and overflow items from the UI store, highlights the active
 * route based on the current pathname, and closes the "More" popover when a menu item is selected.
 *
 * @returns The JSX element for the bottom navigation bar
 */
export function BottomNav() {
  const pathname = usePathname();
  const { pendingHref, beginPending } = useNavPending();
  const [moreOpen, setMoreOpen] = useState(false);
  const navOrder = useUIStore((s) => s.navOrder);
  const disabledNavItems = useUIStore((s) => s.disabledNavItems);

  const { tabs, moreItems } = useMemo(() => {
    const enabled = getEnabledNavItems(navOrder, disabledNavItems);
    return getBottomNavLayout(enabled);
  }, [navOrder, disabledNavItems]);

  const isMoreActive = moreItems.some(
    (item) => pathname === item.href || pathname.startsWith(item.href + '/')
  );

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around h-12">
        {tabs.map(({ href, icon: Icon, shortLabel }) => {
          const isActive = pathname === href || pathname.startsWith(href + '/');
          const isPending = pendingHref === href;
          return (
            <Link
              key={href}
              href={href}
              onClick={(event) => {
                if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                  return;
                }
                beginPending(href);
              }}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 flex-1 h-full min-h-[48px] text-[10px] font-medium transition-colors',
                isActive ? 'text-primary' : 'text-muted-foreground',
                isPending && 'opacity-70'
              )}
            >
              {isPending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} />
              )}
              {shortLabel}
            </Link>
          );
        })}

        {/* More button — only shown when there are items beyond the first 4 */}
        {moreItems.length > 0 && (
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
                  const isPending = pendingHref === href;
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={(event) => {
                        setMoreOpen(false);
                        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                          return;
                        }
                        beginPending(href);
                      }}
                      className={cn(
                        'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors min-h-[44px]',
                        isActive
                          ? 'bg-primary/10 text-primary'
                          : 'text-foreground hover:bg-accent',
                        isPending && 'opacity-70'
                      )}
                    >
                      {isPending ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" /> : <Icon className="h-5 w-5 shrink-0" />}
                      {label}
                    </Link>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </nav>
  );
}
