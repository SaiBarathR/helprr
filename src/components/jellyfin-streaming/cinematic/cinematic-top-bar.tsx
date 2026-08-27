'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronLeft, Clapperboard, Heart, LayoutGrid, LogOut, Radio, Search } from 'lucide-react';
import { useUIStore } from '@/lib/store';
import { resolveDefaultPageHref } from '@/lib/nav-config';
import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/jellyfin/library', label: 'Home', icon: Clapperboard, match: (path: string) => path === '/jellyfin/library' },
  { href: '/jellyfin/library/favorites', label: 'My List', icon: Heart, match: (path: string) => path.startsWith('/jellyfin/library/favorites') },
  { href: '/jellyfin/library/browse/libraries', label: 'Browse', icon: LayoutGrid, match: (path: string) => path.startsWith('/jellyfin/library/browse') },
  { href: '/jellyfin/library/live', label: 'Live', icon: Radio, match: (path: string) => path.startsWith('/jellyfin/library/live') },
  { href: '/jellyfin/library/search', label: 'Search', icon: Search, match: (path: string) => path.startsWith('/jellyfin/library/search') },
] as const;

/**
 * Chrome that recedes: transparent over the billboard, solid once the page
 * scrolls. That single behaviour is most of what makes a streaming home feel
 * like one continuous surface rather than a page inside an app.
 *
 * The links are plain text rather than the classic skin's pill nav — an active
 * item is marked by weight and colour alone, as on every service.
 */
export function CinematicTopBar({ className }: { className?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  // The Watch home has nowhere useful to go back to, so the arrow would just
  // be noise there; every page below it does.
  const showBack = pathname !== '/jellyfin/library';
  // Cinematic hides the sidebar, so this bar carries the only way back to the
  // rest of Helprr. It has to be an explicit door rather than the browser's
  // back button: someone who opens Watch directly, or wanders three titles
  // deep, has no "back" that leads anywhere useful.
  const navOrder = useUIStore((s) => s.navOrder);
  const disabledNavItems = useUIStore((s) => s.disabledNavItems);
  const defaultPage = useUIStore((s) => s.defaultPage);
  const exitHref = resolveDefaultPageHref({ defaultPage, navOrder, disabledNavItems });

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div
      className={cn(
        'sticky top-[var(--header-height,0px)] z-40 -mx-[var(--main-pad-x)] px-[var(--main-pad-x)]',
        'flex items-center gap-3 py-2 transition-colors duration-300',
        scrolled ? 'bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80' : 'bg-transparent',
        className,
      )}
    >
      {showBack && (
        <button
          type="button"
          aria-label="Go back"
          title="Back"
          onClick={() => router.back()}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
        >
          <ChevronLeft className="size-5" />
        </button>
      )}

      <nav aria-label="Watch sections" className="flex min-w-0 items-center gap-4 overflow-x-auto scrollbar-hide sm:gap-6">
        {ITEMS.map(({ href, label, icon: Icon, match }) => {
          const isActive = match(pathname);
          return (
            <Link
              key={href}
              href={href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 text-sm transition-colors',
                isActive ? 'font-semibold text-white' : 'font-normal text-white/65 hover:text-white',
              )}
            >
              <Icon className="size-4 shrink-0 sm:hidden" />
              <span className="hidden sm:inline">{label}</span>
            </Link>
          );
        })}
      </nav>

      <Link
        href={exitHref}
        title="Leave the Watch section"
        // ml-auto pins it right where the bar spans the page; several pages
        // nest this toolbar in their own flex row, where it is content-sized
        // and there is no free space — hence the rule, so Exit still reads as
        // separate from the section nav rather than a sixth tab.
        className="ml-auto inline-flex shrink-0 items-center gap-1.5 border-l border-white/15 py-1 pr-1 pl-3 text-sm text-white/65 transition-colors hover:text-white"
      >
        <LogOut className="size-4 shrink-0" />
        <span className="hidden sm:inline">Exit</span>
      </Link>
    </div>
  );
}
