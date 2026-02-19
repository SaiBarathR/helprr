'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  Clapperboard,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { useState } from 'react';
import { useNavConfig } from '@/components/layout/nav-config-provider';
import { NAV_ICON_MAP } from '@/components/layout/nav-icons';
import { isNavItemActive } from '@/lib/navigation-config';

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const { effectiveNav } = useNavConfig();

  return (
    <aside
      className={cn(
        'hidden md:flex flex-col border-r border-border bg-card h-screen sticky top-0 transition-all duration-200',
        collapsed ? 'w-16' : 'w-56'
      )}
    >
      <div className={cn('flex items-center gap-2 px-4 h-14 border-b border-border', collapsed && 'justify-center px-2')}>
        <Clapperboard className="h-6 w-6 text-primary shrink-0" />
        {!collapsed && <span className="font-semibold text-lg">Helprr</span>}
      </div>

      <nav className="flex-1 py-2 space-y-1 px-2">
        {effectiveNav.sidebarItems.map((item) => {
          const Icon = NAV_ICON_MAP[item.iconKey];
          const isActive = isNavItemActive(pathname, item);
          const link = (
            <Link
              key={item.id}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                collapsed && 'justify-center px-2'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && item.label}
            </Link>
          );

          if (collapsed) {
            return (
              <Tooltip key={item.id}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
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
          onClick={() => setCollapsed(!collapsed)}
          className={cn('w-full', collapsed ? 'justify-center' : 'justify-start')}
        >
          {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          {!collapsed && <span className="ml-2">Collapse</span>}
        </Button>
      </div>
    </aside>
  );
}
