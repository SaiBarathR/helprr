'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { LogOut, Search } from 'lucide-react';
import { useCompactViewport } from '@/lib/hooks/use-compact-viewport';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { useUIStore } from '@/lib/store';
import { useWatchSkin } from '@/lib/hooks/use-watch-skin';
import { resolveDefaultPageHref } from '@/lib/nav-config';
import type { CatalogHomeResponse } from '@/types/jellyfin-streaming';
import { cn } from '@/lib/utils';

interface NavEntry {
  href: string;
  label: string;
  isActive: (pathname: string) => boolean;
}

/**
 * The Watch section's masthead: logo left, sections beside it, tools right.
 *
 * It lives in the Watch layout rather than in each page. Previously every page
 * rendered the bar itself, which put it *below* the billboard on the home page
 * — the site's header is the first thing on the page and floats over the
 * billboard, so a bar sitting between the hero and the first row read as a
 * random strip of links.
 *
 * The sections mirror the site's: Home, then the real libraries (TV Shows,
 * Movies — resolved from the server rather than hardcoded, because they are
 * whatever the owner actually has), then My List and Browse.
 */
export function CinematicHeader() {
  const skin = useWatchSkin();
  const pathname = usePathname();
  const compact = useCompactViewport();
  const [scrolled, setScrolled] = useState(false);

  const navOrder = useUIStore((s) => s.navOrder);
  const disabledNavItems = useUIStore((s) => s.disabledNavItems);
  const defaultPage = useUIStore((s) => s.defaultPage);
  const exitHref = resolveDefaultPageHref({ defaultPage, navOrder, disabledNavItems });

  // Reuses the home payload, so this costs nothing beyond what the page fetches.
  const home = useQuery({
    queryKey: queryKeys.jellyfinHome(),
    queryFn: jsonFetcher<CatalogHomeResponse>('/api/jellyfin/catalog/home'),
    enabled: skin === 'cinematic',
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const entries = useMemo<NavEntry[]>(() => {
    const views = home.data?.views ?? [];
    const has = (type: string) => views.some((view) => (view.CollectionType || '').toLowerCase() === type);

    const list: NavEntry[] = [
      { href: '/jellyfin/library', label: 'Home', isActive: (path) => path === '/jellyfin/library' },
    ];
    // TV Shows and Movies are the browsing hubs — a billboard and genre rails,
    // the way the site presents them. The exhaustive grid lives under Browse,
    // which is where you go when you actually want the whole list.
    if (has('tvshows')) {
      list.push({ href: '/jellyfin/library/shows', label: 'TV Shows', isActive: (path) => path.startsWith('/jellyfin/library/shows') });
    }
    if (has('movies')) {
      list.push({ href: '/jellyfin/library/movies', label: 'Movies', isActive: (path) => path.startsWith('/jellyfin/library/movies') });
    }
    list.push(
      { href: '/jellyfin/library/new', label: 'New & Popular', isActive: (path) => path.startsWith('/jellyfin/library/new') },
      { href: '/jellyfin/library/favorites', label: 'My List', isActive: (path) => path.startsWith('/jellyfin/library/favorites') },
      { href: '/jellyfin/library/browse/libraries', label: 'Browse', isActive: (path) => path.startsWith('/jellyfin/library/browse') },
      { href: '/jellyfin/library/live', label: 'Live', isActive: (path) => path.startsWith('/jellyfin/library/live') },
    );
    return list;
  }, [home.data?.views]);

  if (skin !== 'cinematic') return null;

  if (compact) {
    // The app puts its header above the hero card, not over it: a wordmark row
    // and then a row of chips. Overlaying a portrait poster the way the
    // desktop billboard is overlaid buries the artwork's own title.
    return (
      <header className="sticky top-0 z-50 -mx-[var(--main-pad-x)] bg-[#141414] px-[var(--main-pad-x)] pt-1 pb-2">
        <div className="flex items-center gap-3 py-1">
          <Link
            href="/jellyfin/library"
            aria-label="Watch home"
            className="text-xl font-extrabold tracking-[-0.04em] text-[#e50914] uppercase"
          >
            Helprr
          </Link>
          <span className="ml-auto flex items-center gap-4">
            <Link href="/jellyfin/library/search" aria-label="Search" className="text-white">
              <Search className="size-[22px]" />
            </Link>
            <Link href={exitHref} aria-label="Leave the Watch section" className="text-white">
              <LogOut className="size-[22px]" />
            </Link>
          </span>
        </div>

        <nav aria-label="Watch sections" className="flex items-center gap-2 overflow-x-auto pt-1 scrollbar-hide">
          {entries.map((entry) => {
            const active = entry.isActive(pathname);
            return (
              <Link
                key={entry.label}
                href={entry.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] whitespace-nowrap transition-colors',
                  active
                    ? 'border-white bg-white font-medium text-black'
                    : 'border-white/25 bg-white/5 font-normal text-white/85',
                )}
              >
                {entry.label}
              </Link>
            );
          })}
        </nav>
      </header>
    );
  }

  return (
    <header
      className={cn(
        // Sticky and pulled back over the content, so the billboard runs to the
        // very top of the page with the header floating on it — as on the site.
        'sticky top-0 z-50 h-[4.5rem] md:-mb-[4.5rem]',
        '-mx-[var(--main-pad-x)] px-[var(--main-pad-x)]',
        'flex items-center gap-4 transition-colors duration-300 md:gap-6',
        // Transparent at rest: the billboard paints its own top ramp, and a
        // second gradient here stacked into a visible band across the page.
        scrolled ? 'bg-[#141414]' : 'bg-transparent',
      )}
    >
      <Link
        href="/jellyfin/library"
        aria-label="Watch home"
        className="shrink-0 text-xl font-extrabold tracking-[-0.04em] text-[#e50914] uppercase md:text-2xl"
      >
        Helprr
      </Link>

      <nav aria-label="Watch sections" className="flex min-w-0 flex-1 items-center gap-4 overflow-x-auto scrollbar-hide md:gap-5">
        {entries.map((entry) => {
          const active = entry.isActive(pathname);
          return (
            <Link
              key={entry.label}
              href={entry.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'shrink-0 text-sm whitespace-nowrap transition-colors md:text-base',
                active ? 'font-medium text-white' : 'font-normal text-[#e5e5e5] hover:text-[#b3b3b3]',
              )}
            >
              {entry.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex shrink-0 items-center gap-4">
        <Link href="/jellyfin/library/search" aria-label="Search" title="Search" className="text-white transition-opacity hover:opacity-80">
          <Search className="size-5" />
        </Link>
        <Link
          href={exitHref}
          title="Leave the Watch section"
          className="inline-flex items-center gap-1.5 text-sm text-[#e5e5e5] transition-colors hover:text-white"
        >
          <LogOut className="size-[18px]" />
          <span className="hidden sm:inline">Exit</span>
        </Link>
      </div>
    </header>
  );
}

/**
 * The section name, set large under the header.
 *
 * Helprr's house rule is sr-only page titles and the classic skin keeps it;
 * the cinematic skin is a deliberate exception, because the site leads every
 * page but Home with its name. It also supplies the top offset those pages
 * need, since the header is pulled back over the content for the billboard's
 * sake.
 */
export function CinematicPageHeading() {
  const skin = useWatchSkin();
  const pathname = usePathname();
  if (skin !== 'cinematic') return null;

  // Every route needs the clearance, home included. The header is pulled back
  // over the content by its own negative margin so it can sit flush at the top
  // of the viewport; this spacer cancels that pull, which is what puts the
  // billboard *below* the header rather than under it. Home was the only page
  // that returned early and skipped it, which is exactly why it was the only
  // page where the two overlapped.
  const clearance = <div aria-hidden className="hidden md:block md:h-[4.5rem]" />;

  // Home, the hubs and the detail pages all set their own headings.
  if (
    pathname === '/jellyfin/library'
    || pathname.startsWith('/jellyfin/library/shows')
    || pathname.startsWith('/jellyfin/library/movies')
  ) {
    return clearance;
  }

  const label = pathname.startsWith('/jellyfin/library/new') ? 'New & Popular'
    : pathname.startsWith('/jellyfin/library/favorites') ? 'My List'
    : pathname.startsWith('/jellyfin/library/browse') ? 'Browse'
      : pathname.startsWith('/jellyfin/library/live') ? 'Live TV'
        : pathname.startsWith('/jellyfin/library/search') ? 'Search'
          : null;

  // Detail pages have their own hero, so they only need the clearance.
  if (!label) return clearance;

  return (
    <h1 className="pt-4 pb-4 text-2xl font-medium tracking-tight md:pt-[5.5rem] md:text-3xl">{label}</h1>
  );
}
