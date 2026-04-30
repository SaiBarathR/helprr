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

export function BottomNav() {
  const pathname = usePathname();
  const { pendingHref, beginPending } = useNavPending();
  const [moreOpen, setMoreOpen] = useState(false);
  const navOrder = useUIStore((s) => s.navOrder);
  const disabledNavItems = useUIStore((s) => s.disabledNavItems);
  const navPosition = useUIStore((s) => s.navPosition);
  const isBottom = navPosition === 'bottom';

  const { tabs, moreItems } = useMemo(() => {
    const enabled = getEnabledNavItems(navOrder, disabledNavItems);
    return getBottomNavLayout(enabled);
  }, [navOrder, disabledNavItems]);

  const isMoreActive = moreItems.some(
    (item) => pathname === item.href || pathname.startsWith(item.href + '/')
  );

  return (
    <nav
      className={cn(
        'md:hidden z-50',
        // Layered tinted glass — floats over content rather than reading as a bar
        'bg-background/70 backdrop-blur-2xl supports-[backdrop-filter]:bg-background/60',
        isBottom
          ? 'fixed bottom-0 left-0 right-0 border-t border-border/60 pb-[env(safe-area-inset-bottom)]'
          : 'sticky top-0 border-b border-border/60 pt-[env(safe-area-inset-top)]'
      )}
    >
      {/* Top hairline glow */}
      <div
        aria-hidden
        className={cn(
          'absolute inset-x-6 h-px pointer-events-none',
          isBottom ? 'top-0' : 'bottom-0'
        )}
        style={{
          background:
            'linear-gradient(90deg, transparent, var(--amber-soft), transparent)',
        }}
      />

      <div className="flex items-center justify-around h-14 px-1">
        {tabs.map(({ href, icon: Icon, shortLabel }) => {
          const isActive =
            pathname === href || pathname.startsWith(href + '/');
          const isPending = pendingHref === href;
          return (
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
                'group relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full min-h-[48px] text-[10px] font-medium transition-colors',
                isActive ? 'text-primary' : 'text-muted-foreground active:text-foreground',
                isPending && 'opacity-70'
              )}
            >
              {/* Top amber dot indicator */}
              <span
                aria-hidden
                className={cn(
                  'absolute h-1 w-1 rounded-full bg-primary transition-all duration-300',
                  isBottom ? 'bottom-1' : 'top-1',
                  isActive ? 'opacity-100 scale-100' : 'opacity-0 scale-50'
                )}
                style={isActive ? { boxShadow: '0 0 8px var(--amber-glow)' } : undefined}
              />

              <span
                className={cn(
                  'flex items-center justify-center transition-transform duration-200',
                  isActive && 'scale-[1.04]'
                )}
              >
                {isPending ? (
                  <Loader2 className="h-[22px] w-[22px] animate-spin" />
                ) : (
                  <Icon
                    className="h-[22px] w-[22px]"
                    strokeWidth={isActive ? 2.2 : 1.75}
                  />
                )}
              </span>
              <span
                className={cn(
                  'leading-none tracking-tight',
                  isActive && 'font-semibold'
                )}
              >
                {shortLabel}
              </span>
            </Link>
          );
        })}

        {moreItems.length > 0 && (
          <Popover open={moreOpen} onOpenChange={setMoreOpen}>
            <PopoverTrigger asChild>
              <button
                aria-label="More navigation"
                className={cn(
                  'group relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full min-h-[48px] text-[10px] font-medium transition-colors',
                  isMoreActive ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'absolute h-1 w-1 rounded-full bg-primary transition-all duration-300',
                    isBottom ? 'bottom-1' : 'top-1',
                    isMoreActive ? 'opacity-100 scale-100' : 'opacity-0 scale-50'
                  )}
                  style={isMoreActive ? { boxShadow: '0 0 8px var(--amber-glow)' } : undefined}
                />
                <MoreHorizontal
                  className="h-[22px] w-[22px]"
                  strokeWidth={isMoreActive ? 2.2 : 1.75}
                />
                <span
                  className={cn(
                    'leading-none tracking-tight',
                    isMoreActive && 'font-semibold'
                  )}
                >
                  More
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent
              side={isBottom ? 'top' : 'bottom'}
              align="end"
              sideOffset={12}
              className="w-60 p-2 rounded-xl border-border/60 bg-popover/95 backdrop-blur-xl shadow-2xl"
            >
              <div className="px-2 pt-1 pb-2">
                <span className="tracked-caps text-[10px] text-muted-foreground">
                  More
                </span>
              </div>
              <div className="space-y-0.5">
                {moreItems.map(({ href, icon: Icon, label }) => {
                  const isActive =
                    pathname === href || pathname.startsWith(href + '/');
                  const isPending = pendingHref === href;
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={(event) => {
                        setMoreOpen(false);
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
                      className={cn(
                        'relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors min-h-[44px]',
                        isActive
                          ? 'bg-primary/10 text-primary'
                          : 'text-foreground hover:bg-accent',
                        isPending && 'opacity-70'
                      )}
                    >
                      {isPending ? (
                        <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
                      ) : (
                        <Icon
                          className="h-5 w-5 shrink-0"
                          strokeWidth={isActive ? 2.2 : 1.75}
                        />
                      )}
                      <span className="flex-1">{label}</span>
                      {isActive && (
                        <span
                          aria-hidden
                          className="w-1.5 h-1.5 rounded-full bg-primary"
                          style={{ boxShadow: '0 0 8px var(--amber-glow)' }}
                        />
                      )}
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
