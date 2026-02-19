'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Clapperboard, PanelLeftClose, PanelLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useUIStore } from '@/lib/store';
import { getEnabledNavItems } from '@/lib/nav-config';

export function Sidebar() {
  const pathname = usePathname();
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
        'hidden md:flex flex-col border-r border-border bg-card h-screen sticky top-0 transition-all duration-200',
        sidebarCollapsed ? 'w-16' : 'w-56'
      )}
    >
      <div className={cn('flex items-center gap-2 px-4 h-14 border-b border-border', sidebarCollapsed && 'justify-center px-2')}>
        <Clapperboard className="h-6 w-6 text-primary shrink-0" />
        {!sidebarCollapsed && <span className="font-semibold text-lg">Helprr</span>}
      </div>

      <nav className="flex-1 py-2 space-y-1 px-2">
        {navItems.map(({ href, icon: Icon, label }) => {
          const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
          const link = (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                sidebarCollapsed && 'justify-center px-2'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!sidebarCollapsed && label}
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
