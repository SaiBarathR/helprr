'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { PanelLeftClose, PanelLeft, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useUIStore } from '@/lib/store';
import { getActiveNavHref, getEnabledNavItems, navItemAllowed } from '@/lib/nav-config';
import { useNavPending } from '@/hooks/use-nav-pending';
import { useMe, hasCapability } from '@/components/permission-provider';
import { useSearchPalette } from '@/components/search/search-store';
import { useBadgeCounts } from '@/components/layout/badge-provider';
import { NavBadge } from '@/components/layout/nav-badge';

/**
 * Render the application's responsive, collapsible navigation sidebar.
 *
 * Reads collapse state and navigation configuration from the UI store to display
 * navigation links with icons, active-state highlighting, and a toggle control.
 *
 * @returns The sidebar React element containing navigation links, icons, a collapse/expand control, and tooltips for labels when collapsed.
 */
export function Sidebar() {
  const pathname = usePathname();
  const { pendingHref, beginPending } = useNavPending();
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const navOrder = useUIStore((s) => s.navOrder);
  const disabledNavItems = useUIStore((s) => s.disabledNavItems);
  const me = useMe();
  const counts = useBadgeCounts();
  const openSearch = useSearchPalette((s) => s.setOpen);

  const navItems = useMemo(
    () =>
      getEnabledNavItems(navOrder, disabledNavItems).filter(
        (item) => navItemAllowed(item, (cap) => hasCapability(me, cap))
      ),
    [navOrder, disabledNavItems, me]
  );

  const activeHref = getActiveNavHref(navItems, pathname);

  const searchButton = (
    <button
      onClick={() => openSearch(true)}
      className={cn(
        'w-full relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
        sidebarCollapsed && 'justify-center px-2'
      )}
    >
      <Search className="h-4 w-4 shrink-0" />
      {!sidebarCollapsed && (
        <>
          <span>Search</span>
          <kbd className="ml-auto rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            ⌘K
          </kbd>
        </>
      )}
    </button>
  );

  return (
    <aside
      className={cn(
        'hidden md:flex flex-col border-r border-border bg-card app-chrome-bar h-screen sticky top-0 transition-all duration-200',
        sidebarCollapsed ? 'w-16' : 'w-56'
      )}
    >
      <nav className="flex-1 min-h-0 overflow-y-auto no-scrollbar pt-3 pb-2 space-y-1 px-2">
        {sidebarCollapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>{searchButton}</TooltipTrigger>
            <TooltipContent side="right">Search (⌘K)</TooltipContent>
          </Tooltip>
        ) : (
          searchButton
        )}

        {navItems.map(({ href, icon: Icon, label, badgeArea }) => {
          const slice = badgeArea ? counts[badgeArea] : undefined;
          const isActive = href === activeHref;
          const isPending = pendingHref === href;
          const link = (
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
                'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                isPending && 'opacity-70',
                sidebarCollapsed && 'justify-center px-2'
              )}
            >
              {isPending ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Icon className="h-4 w-4 shrink-0" />}
              {!sidebarCollapsed && label}
              {!sidebarCollapsed && <NavBadge slice={slice} className="ml-auto" />}
              {sidebarCollapsed && <NavBadge slice={slice} dot className="absolute right-1.5 top-1.5" />}
            </Link>
          );

          if (sidebarCollapsed) {
            return (
              <Tooltip key={href}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
            );
          }

          return link;
        })}
      </nav>

      <div className="border-t border-border p-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleSidebar}
          className={cn('w-full', sidebarCollapsed ? 'justify-center' : 'justify-start')}
        >
          {sidebarCollapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          {!sidebarCollapsed && <span className="ml-2">Collapse</span>}
        </Button>
      </div>
    </aside>
  );
}
