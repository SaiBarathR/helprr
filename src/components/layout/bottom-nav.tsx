'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { MoreHorizontal } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useNavConfig } from '@/components/layout/nav-config-provider';
import { NAV_ICON_MAP } from '@/components/layout/nav-icons';
import { isNavItemActive } from '@/lib/navigation-config';

export function BottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const { effectiveNav } = useNavConfig();

  const isMoreActive = effectiveNav.moreItems.some((item) => isNavItemActive(pathname, item));

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around h-12">
        {effectiveNav.bottomItems.map((item) => {
          const Icon = NAV_ICON_MAP[item.iconKey];
          const isActive = isNavItemActive(pathname, item);
          return (
            <Link
              key={item.id}
              href={item.href}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 flex-1 h-full min-h-[48px] text-[10px] font-medium transition-colors',
                isActive ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} />
              {item.label}
            </Link>
          );
        })}

        {effectiveNav.moreItems.length > 0 ? (
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
                {effectiveNav.moreItems.map((item) => {
                  const Icon = NAV_ICON_MAP[item.iconKey];
                  const isActive = isNavItemActive(pathname, item);
                  return (
                    <Link
                      key={item.id}
                      href={item.href}
                      onClick={() => setMoreOpen(false)}
                      className={cn(
                        'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors min-h-[44px]',
                        isActive
                          ? 'bg-primary/10 text-primary'
                          : 'text-foreground hover:bg-accent'
                      )}
                    >
                      <Icon className="h-5 w-5 shrink-0" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
    </nav>
  );
}
