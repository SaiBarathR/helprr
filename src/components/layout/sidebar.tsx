'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { PanelLeftClose, PanelLeft, Loader2 } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useUIStore } from '@/lib/store';
import { getEnabledNavItems } from '@/lib/nav-config';
import { useNavPending } from '@/hooks/use-nav-pending';

export function Sidebar() {
  const pathname = usePathname();
  const { pendingHref, beginPending } = useNavPending();
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const navOrder = useUIStore((s) => s.navOrder);
  const disabledNavItems = useUIStore((s) => s.disabledNavItems);

  const navItems = useMemo(
    () => getEnabledNavItems(navOrder, disabledNavItems),
    [navOrder, disabledNavItems]
  );

  return (
    <aside
      className={cn(
        'hidden md:flex flex-col h-screen sticky top-0 z-40 transition-[width] duration-300 ease-out',
        'bg-sidebar/80 backdrop-blur-xl border-r border-sidebar-border',
        sidebarCollapsed ? 'w-[72px]' : 'w-[240px]'
      )}
    >
      {/* Brand block — marquee strip */}
      <div
        className={cn(
          'relative flex items-center h-16 px-5 border-b border-sidebar-border',
          sidebarCollapsed && 'justify-center px-0'
        )}
      >
        {sidebarCollapsed ? (
          <span className="font-display text-2xl leading-none tracking-tight">
            <span className="italic">H</span>
            <span style={{ color: 'var(--amber)' }}>r</span>
          </span>
        ) : (
          <Link href="/dashboard" className="flex items-baseline gap-2 group">
            <span className="font-display text-[26px] leading-none tracking-[-0.04em] font-medium">
              <span className="italic">Help</span>
              <span style={{ color: 'var(--amber)' }}>rr</span>
            </span>
            <span className="marquee-dot translate-y-[-2px]" />
          </Link>
        )}
        {/* Top hairline accent */}
        <div
          className="absolute inset-x-4 top-0 h-px"
          style={{
            background:
              'linear-gradient(90deg, transparent, var(--amber-soft) 50%, transparent)',
          }}
        />
      </div>

      {/* Section eyebrow */}
      {!sidebarCollapsed && (
        <div className="px-5 pt-5 pb-2">
          <span className="tracked-caps text-muted-foreground/70 text-[10px]">
            Library
          </span>
        </div>
      )}

      <nav
        className={cn(
          'flex-1 overflow-y-auto scrollbar-hide',
          sidebarCollapsed ? 'px-2 pt-3 space-y-0.5' : 'px-3 space-y-0.5'
        )}
      >
        {navItems.map(({ href, icon: Icon, label }) => {
          const isActive =
            pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
          const isPending = pendingHref === href;
          const link = (
            <Link
              key={href}
              href={href}
              onClick={(event) => {
                if (
                  event.defaultPrevented ||
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                ) {
                  return;
                }
                beginPending(href);
              }}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'group relative flex items-center gap-3 rounded-md text-sm transition-all duration-200',
                sidebarCollapsed ? 'justify-center px-0 h-11' : 'px-3 h-10',
                isActive
                  ? 'text-foreground bg-sidebar-accent/60'
                  : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/30',
                isPending && 'opacity-70'
              )}
            >
              {/* Active marker — vertical amber bar */}
              <span
                aria-hidden
                className={cn(
                  'absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full transition-all duration-300',
                  isActive
                    ? 'bg-primary opacity-100 scale-y-100'
                    : 'bg-primary opacity-0 scale-y-50 group-hover:opacity-30 group-hover:scale-y-75'
                )}
              />
              {isPending ? (
                <Loader2
                  className={cn(
                    'h-[18px] w-[18px] shrink-0 animate-spin',
                    isActive && 'text-primary'
                  )}
                />
              ) : (
                <Icon
                  className={cn(
                    'h-[18px] w-[18px] shrink-0 transition-colors',
                    isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                  )}
                  strokeWidth={isActive ? 2.2 : 1.75}
                />
              )}
              {!sidebarCollapsed && (
                <span
                  className={cn(
                    'truncate font-medium tracking-tight',
                    isActive && 'text-foreground'
                  )}
                >
                  {label}
                </span>
              )}
              {/* Active dot at right */}
              {!sidebarCollapsed && isActive && (
                <span
                  aria-hidden
                  className="ml-auto w-1.5 h-1.5 rounded-full bg-primary"
                  style={{ boxShadow: '0 0 8px var(--amber-glow)' }}
                />
              )}
            </Link>
          );

          if (sidebarCollapsed) {
            return (
              <Tooltip key={href}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right" className="font-medium">
                  {label}
                </TooltipContent>
              </Tooltip>
            );
          }

          return link;
        })}
      </nav>

      {/* Footer — collapse + projector status */}
      <div className="border-t border-sidebar-border p-3">
        {!sidebarCollapsed && (
          <div className="mb-3 flex items-center justify-between px-2 py-2 rounded-md bg-sidebar-accent/30">
            <div className="flex items-center gap-2">
              <span className="marquee-dot" />
              <span className="tracked-caps text-[10px] text-muted-foreground">
                Live · Polling
              </span>
            </div>
            <span className="font-mono tabular text-[10px] text-muted-foreground">
              30s
            </span>
          </div>
        )}
        <button
          onClick={toggleSidebar}
          className={cn(
            'press-feedback w-full flex items-center gap-2 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/40 transition-colors',
            sidebarCollapsed ? 'h-10 justify-center' : 'h-9 px-3'
          )}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? (
            <PanelLeft className="h-4 w-4" />
          ) : (
            <>
              <PanelLeftClose className="h-4 w-4" />
              <span className="tracked-caps text-[10px]">Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
