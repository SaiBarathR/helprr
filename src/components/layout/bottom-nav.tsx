'use client';

import { useState, useMemo } from 'react';
import Link from '@/components/ui/app-link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Loader2, MoreHorizontal, Search, SlidersHorizontal } from 'lucide-react';
import { ResponsiveMenu, ResponsiveMenuItem } from '@/components/ui/responsive-menu';
import { useUIStore } from '@/lib/store';
import { getActiveNavHref, getEnabledNavItems, getBottomNavLayout, navItemAllowed } from '@/lib/nav-config';
import { usePendingHref } from '@/components/layout/navigation-provider';
import { useMe, hasCapability } from '@/components/permission-provider';
import { useBadgeCounts } from '@/components/layout/badge-provider';
import { NavBadge } from '@/components/layout/nav-badge';
import { useSearchPalette } from '@/components/search/search-store';
import type { BadgeSlice } from '@/types/badges';

export function BottomNav() {
  const pathname = usePathname();
  const pendingHref = usePendingHref();
  const [moreOpen, setMoreOpen] = useState(false);
  const navOrder = useUIStore((s) => s.navOrder);
  const disabledNavItems = useUIStore((s) => s.disabledNavItems);
  const me = useMe();
  const counts = useBadgeCounts();
  const openSearch = useSearchPalette((state) => state.setOpen);

  const { tabs, moreItems } = useMemo(() => {
    const enabled = getEnabledNavItems(navOrder, disabledNavItems).filter(
      (item) => navItemAllowed(item, (cap) => hasCapability(me, cap), me)
    );
    return getBottomNavLayout(enabled);
  }, [navOrder, disabledNavItems, me]);

  const activeHref = getActiveNavHref([...tabs, ...moreItems], pendingHref?.split('?')[0] || pathname);
  const isMoreActive = moreItems.some((item) => item.href === activeHref);

  // Roll the hidden items' badges into one count on the "More" button. The
  // Activity queue and Torrents largely count the same downloads, so when both
  // are hidden only Torrents counts.
  const moreBadge = useMemo<BadgeSlice>(
    () => {
      const hasDownloads = moreItems.some((item) => item.badgeArea === 'downloads');
      return moreItems.reduce(
        (acc, item) => {
          if (hasDownloads && item.badgeArea === 'activity') return acc;
          const slice = item.badgeArea ? counts[item.badgeArea] : undefined;
          if (slice) {
            acc.total += slice.total;
            acc.attention += slice.attention;
          }
          return acc;
        },
        { total: 0, attention: 0 },
      );
    },
    [moreItems, counts],
  );

  return (
    <nav
      // Stable hook for the cinematic Watch skin, which goes full screen.
      data-app-bottom-nav
      // Its edge, border and safe-area padding come from .app-tab-bar (globals.css).
      className="app-tab-bar md:hidden z-50 border-border app-chrome-bar bg-background/95 backdrop-blur-sm"
    >
      <div className="flex items-center justify-around h-12">
        {tabs.map(({ href, icon: Icon, shortLabel, badgeArea }) => {
          const slice = badgeArea ? counts[badgeArea] : undefined;
          const isActive = href === activeHref;
          const isPending = pendingHref === href;
          return (
            <Link
              key={href}
              href={href}
              prefetch={null}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 flex-1 h-full min-h-[48px] text-[11px] font-medium transition-colors',
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
                <NavBadge slice={slice} className="absolute -right-2.5 -top-1.5 h-4 min-w-[1rem] px-1 text-[10px]" />
              </span>
              {shortLabel}
            </Link>
          );
        })}

        {moreItems.length > 0 && (
          <ResponsiveMenu
            title="More"
            open={moreOpen}
            onOpenChange={setMoreOpen}
            trigger={(
              <button
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 flex-1 h-full min-h-[48px] text-[11px] font-medium transition-colors',
                  isMoreActive ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                <span className="relative">
                  <MoreHorizontal className="h-5 w-5" strokeWidth={isMoreActive ? 2.5 : 2} />
                  <NavBadge slice={moreBadge} className="absolute -right-2.5 -top-1.5 h-4 min-w-[1rem] px-1 text-[10px]" />
                </span>
                More
              </button>
            )}
            footer={(
              <ResponsiveMenuItem>
                <Link
                  href="/settings/appearance#navigation"
                  prefetch={null}
                  onClick={() => setMoreOpen(false)}
                  className="flex min-h-11 items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent"
                >
                  <SlidersHorizontal className="h-5 w-5 shrink-0" />
                  Customize tabs
                </Link>
              </ResponsiveMenuItem>
            )}
          >
            <div className="space-y-0.5">
              {moreItems.map(({ href, icon: Icon, label, badgeArea }) => {
                const slice = badgeArea ? counts[badgeArea] : undefined;
                const isActive = href === activeHref;
                const isPending = pendingHref === href;
                return (
                  <ResponsiveMenuItem key={href}>
                    <Link
                      href={href}
                      prefetch={null}
                      onClick={(event) => {
                        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                          return;
                        }
                        setMoreOpen(false);
                      }}
                      className={cn(
                        'flex min-h-11 items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
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
                  </ResponsiveMenuItem>
                );
              })}
            </div>
          </ResponsiveMenu>
        )}

        {/* Phone search: the sidebar's search and its shortcut hint are md+ only. */}
        <button
          type="button"
          onClick={() => openSearch(true)}
          className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full min-h-[48px] text-[11px] font-medium text-muted-foreground transition-colors"
        >
          <Search className="h-5 w-5" />
          Search
        </button>
      </div>
    </nav>
  );
}
