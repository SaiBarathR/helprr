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

// With Liquid Glass's blue tint only the active icon takes the accent: as a
// small label the tint is under AA on the bar and the More sheet in both
// schemes (glass-contrast.test.ts). Other themes tint the label through
// --hpr-tab-label, which is the text colour for the cyan accent (dashboard-theme.ts).
const GLASS_ACTIVE_LABEL = '[html[data-glass]_&]:text-foreground';
const ACTIVE_LABEL = 'text-[color:var(--hpr-tab-label,var(--primary))]';
// One tab slot: an icon over a 10px label, as iOS sets them. The label
// truncates rather than run into the next slot or the bar's rounded end.
const SLOT = 'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 h-full min-h-11 text-[10px] font-medium leading-tight transition-colors';
const SLOT_LABEL = 'max-w-full truncate tracking-[-0.01em]';
// A count overlaps only the icon's top-right corner, as on iOS tabs, ringed
// in the bar's colour so it reads apart from the icon. The bar's 14px inner
// padding and the 5px rise keep the badge inside the floating bar's rounded
// end on the last slot at 375px, even for 99+.
const SLOT_BADGE = 'absolute -top-[5px] left-[calc(100%-4px)] h-4 min-w-[1rem] px-1 text-[10px] ring-2 ring-background [html[data-glass]_&]:ring-[color:var(--hpr-glass-bg)]';

/** A tab's name for screen readers: its label first, then its count ("More, 59 unread"), not "59More". */
function slotName(label: string, slice: BadgeSlice | undefined): string | undefined {
  if (!slice || slice.total <= 0) return undefined;
  return `${label}, ${slice.total > 99 ? '99+' : slice.total} unread`;
}

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
      {/* With the nav at the bottom of a phone, the tabs and the round Search
          float as two surfaces of their own (app-tab-surface, globals.css).
          At the top the tab group steps aside (app-tab-group), so Search is
          one more slot in the same row. */}
      <div className="app-tab-row flex items-center h-12">
        <div className="app-tab-surface app-tab-group flex flex-1 min-w-0 items-center justify-around h-full px-3.5">
          {tabs.map(({ href, icon: Icon, shortLabel, badgeArea }) => {
            const slice = badgeArea ? counts[badgeArea] : undefined;
            const isActive = href === activeHref;
            const isPending = pendingHref === href;
            return (
              <Link
                key={href}
                href={href}
                prefetch={null}
                aria-label={slotName(shortLabel, slice)}
                className={cn(
                  SLOT,
                  isActive ? cn(ACTIVE_LABEL, GLASS_ACTIVE_LABEL) : 'text-muted-foreground',
                  isPending && 'opacity-70'
                )}
              >
                <span className="relative">
                  {isPending ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Icon className={cn('h-5 w-5', isActive && 'text-primary')} strokeWidth={isActive ? 2.5 : 2} />
                  )}
                  <NavBadge slice={slice} className={SLOT_BADGE} />
                </span>
                <span className={SLOT_LABEL}>{shortLabel}</span>
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
                  aria-label={slotName('More', moreBadge)}
                  className={cn(
                    SLOT,
                    isMoreActive ? cn(ACTIVE_LABEL, GLASS_ACTIVE_LABEL) : 'text-muted-foreground'
                  )}
                >
                  <span className="relative">
                    <MoreHorizontal className={cn('h-5 w-5', isMoreActive && 'text-primary')} strokeWidth={isMoreActive ? 2.5 : 2} />
                    <NavBadge slice={moreBadge} className={SLOT_BADGE} />
                  </span>
                  <span className={SLOT_LABEL}>More</span>
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
                            ? cn('bg-primary/10', ACTIVE_LABEL, GLASS_ACTIVE_LABEL)
                            : 'text-foreground hover:bg-accent',
                          isPending && 'opacity-70'
                        )}
                      >
                        {isPending ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" /> : <Icon className={cn('h-5 w-5 shrink-0', isActive && 'text-primary')} />}
                        {label}
                        <NavBadge slice={slice} className="ml-auto" />
                      </Link>
                    </ResponsiveMenuItem>
                  );
                })}
              </div>
            </ResponsiveMenu>
          )}
        </div>

        {/* Phone search: the sidebar's search and its shortcut hint are md+ only.
            It never takes a tab's place: at the bottom a round button detached
            beside the bar, as iOS 26 apps place it (globals.css hides its label
            there), and at the top a last slot that looks like the tabs. */}
        <button
          type="button"
          aria-label="Search"
          onClick={() => openSearch(true)}
          className={cn('app-tab-search app-tab-surface', SLOT, 'text-muted-foreground')}
        >
          <Search className="h-5 w-5" />
          <span className={cn('app-tab-search-label', SLOT_LABEL)}>Search</span>
        </button>
      </div>
    </nav>
  );
}
