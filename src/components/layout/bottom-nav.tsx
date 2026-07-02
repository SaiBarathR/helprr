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
import { getActiveNavHref, getEnabledNavItems, getBottomNavLayout } from '@/lib/nav-config';
import { useNavPending } from '@/hooks/use-nav-pending';
import { useMe, hasCapability } from '@/components/permission-provider';
import { useBadgeCounts } from '@/components/layout/badge-provider';
import { NavBadge } from '@/components/layout/nav-badge';
import type { BadgeSlice } from '@/types/badges';

export function BottomNav() {
  const pathname = usePathname();
  const { pendingHref, beginPending } = useNavPending();
  const [moreOpen, setMoreOpen] = useState(false);
  const navOrder = useUIStore((s) => s.navOrder);
  const disabledNavItems = useUIStore((s) => s.disabledNavItems);
  const navPosition = useUIStore((s) => s.navPosition);
  const isBottom = navPosition === 'bottom';
  const me = useMe();
  const counts = useBadgeCounts();

  const { tabs, moreItems } = useMemo(() => {
    const enabled = getEnabledNavItems(navOrder, disabledNavItems).filter(
      (item) => !item.requiredCapability || hasCapability(me, item.requiredCapability)
    );
    return getBottomNavLayout(enabled);
  }, [navOrder, disabledNavItems, me]);

  const activeHref = getActiveNavHref([...tabs, ...moreItems], pathname);
  const isMoreActive = moreItems.some((item) => item.href === activeHref);

  // Roll the hidden items' badges into one indicator on the "More" button.
  const moreBadge = useMemo<BadgeSlice>(
    () =>
      moreItems.reduce(
        (acc, item) => {
          const slice = item.badgeArea ? counts[item.badgeArea] : undefined;
          if (slice) {
            acc.total += slice.total;
            acc.attention += slice.attention;
          }
          return acc;
        },
        { total: 0, attention: 0 },
      ),
    [moreItems, counts],
  );

  return (
    <nav className={cn(
      'md:hidden z-50 border-border app-chrome-bar bg-background/95 backdrop-blur-sm',
      isBottom
        ? 'fixed bottom-0 left-0 right-0 border-t pb-[env(safe-area-inset-bottom)]'
        : 'sticky top-0 border-b pt-[env(safe-area-inset-top)]'
    )}>
      <div className="flex items-center justify-around h-12">
        {tabs.map(({ href, icon: Icon, shortLabel, badgeArea }) => {
          const slice = badgeArea ? counts[badgeArea] : undefined;
          const isActive = href === activeHref;
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
              <span className="relative">
                {isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} />
                )}
                <NavBadge slice={slice} className="absolute -right-2.5 -top-1.5 h-4 min-w-[1rem] px-1 text-[9px]" />
              </span>
              {shortLabel}
            </Link>
          );
        })}

        {moreItems.length > 0 && (
          <Popover open={moreOpen} onOpenChange={setMoreOpen}>
            <PopoverTrigger asChild>
              <button
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 flex-1 h-full min-h-[48px] text-[10px] font-medium transition-colors',
                  isMoreActive ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                <span className="relative">
                  <MoreHorizontal className="h-5 w-5" strokeWidth={isMoreActive ? 2.5 : 2} />
                  <NavBadge slice={moreBadge} dot className="absolute -right-1.5 -top-0.5" />
                </span>
                More
              </button>
            </PopoverTrigger>
            <PopoverContent
              side={isBottom ? 'top' : 'bottom'}
              align="end"
              sideOffset={8}
              collisionPadding={8}
              className="w-56 p-2 max-h-[var(--radix-popover-content-available-height)] overflow-y-auto overscroll-contain no-scrollbar"
            >
              <div className="space-y-0.5">
                {moreItems.map(({ href, icon: Icon, label, badgeArea }) => {
                  const slice = badgeArea ? counts[badgeArea] : undefined;
                  const isActive = href === activeHref;
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
                      <NavBadge slice={slice} className="ml-auto" />
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
