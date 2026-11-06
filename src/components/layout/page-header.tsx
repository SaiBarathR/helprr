'use client';

import { canGoBackInApp, useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { ChevronLeft } from 'lucide-react';
import { useMe, hasCapability } from '@/components/permission-provider';
import { NAV_ITEMS, getActiveNavHref, navItemAllowed, resolveDefaultPageHref } from '@/lib/nav-config';
import { useUIStore } from '@/lib/store';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  subtitle?: React.ReactNode;
  showBack?: boolean;
  onBack?: () => void;
  /**
   * Where Back goes when there is no earlier page in this tab or app window (e.g. a deep link).
   * Defaults to the page's nav section (`/movies/1/files` -> `/movies`) when the user may open it,
   * else the user's default page.
   */
  backHref?: string;
  rightContent?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, showBack = true, onBack, backHref, rightContent, className }: PageHeaderProps) {
  const router = useRouter();
  const me = useMe();
  const goBack = () => {
    if (canGoBackInApp()) return router.back();
    if (backHref) return router.push(backHref);
    // Some detail pages admit more capabilities than their section's own page
    // (e.g. /discover/movie/1 with only movies.view), so only offer sections the user can open.
    const { pathname } = window.location;
    const allowed = NAV_ITEMS.filter((item) => navItemAllowed(item, (cap) => hasCapability(me, cap), me));
    const section = getActiveNavHref(allowed, pathname);
    if (section && section !== pathname) return router.push(section);
    const { defaultPage, navOrder, disabledNavItems } = useUIStore.getState();
    router.push(resolveDefaultPageHref({ defaultPage, navOrder, disabledNavItems }));
  };

  return (
    <header
      className={cn(
        'page-toolbar page-toolbar-flush app-chrome-bar bg-background/80 backdrop-blur-lg',
        className
      )}
    >
      <div className="flex items-center h-11 px-1">
        {/* Left: back button */}
        {showBack && (
          <button
            onClick={onBack || goBack}
            aria-label="Go back"
            className="flex items-center gap-0 text-primary min-w-[44px] min-h-[44px] justify-center -ml-1"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}

        {/* Center: title */}
        <div className="flex-1 min-w-0 px-2">
          {subtitle && (
            <p className="text-[11px] text-muted-foreground truncate leading-tight">{subtitle}</p>
          )}
          <h1 className="text-base font-semibold truncate leading-tight">{title}</h1>
        </div>

        {/* Right: action slots */}
        {rightContent && (
          <div className="flex items-center gap-0.5 shrink-0">
            {rightContent}
          </div>
        )}
      </div>
    </header>
  );
}
