'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Bell, LogOut, Search } from 'lucide-react';
import { useCompactViewport } from '@/lib/hooks/use-compact-viewport';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { useUIStore } from '@/lib/store';
import { useMe } from '@/components/permission-provider';
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

  const router = useRouter();
  const me = useMe();
  const chipsRef = useRef<HTMLElement | null>(null);
  const activeChipRef = useRef<HTMLAnchorElement | null>(null);

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

  // Screens that own their whole top edge: a detail page shows one back arrow,
  // and search puts its field where the masthead would be.
  const isDetail = pathname.startsWith('/jellyfin/library/item/');
  const isSearch = pathname.startsWith('/jellyfin/library/search');
  // The chip row is derived from the libraries, so it only settles once the
  // home payload lands. Rendering it early and splicing TV Shows and Movies in
  // afterwards made every chip after them jump.
  const navReady = home.isSuccess;
  const sectionLabel = entries.find((entry) => entry.isActive(pathname))?.label ?? null;
  // A library grid and a filtered browse list are not nav destinations, so no
  // entry matches and the bar used to read a bare "Watch" while the screen
  // itself repeated its real name underneath. Both pass the name in the URL.
  const nameParam = useSearchParams().get('name');
  const isHome = pathname === '/jellyfin/library';

  // Keep the current section's pill in view. On Live it sat 191px past the
  // right edge, so the screen you were on had no visible marker at all.
  useEffect(() => {
    activeChipRef.current?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [pathname, navReady]);

  if (skin !== 'cinematic') return null;

  if (compact) {
    if (isSearch) return null;

    // A detail screen drops every piece of top-level chrome and shows one back
    // arrow over the hero — the app never carries its chip row into a title.
    if (isDetail) {
      return (
        // h-0, so the arrow *floats over* the still rather than reserving a band
        // above it. This header used to be 80px of real flow height that the
        // hero was expected to slide back under by cancelling --main-pad-top —
        // which never covered more than a few pixels of it, so the screen opened
        // with a black rectangle across the top and the artwork pushed 80px
        // down. The app overlays its back arrow on the artwork, and the stacked
        // hero carries a top vignette to hold it.
        //
        // Still sticky: a zero-height box at the top of the container pins
        // immediately, so the arrow stays reachable as the page scrolls.
        <header className="pointer-events-none sticky top-0 z-50 h-0">
          <button
            type="button"
            aria-label="Go back"
            onClick={() => router.back()}
            className="pointer-events-auto absolute top-[max(0.5rem,env(safe-area-inset-top))] -left-1 flex size-10 items-center justify-center text-white drop-shadow-[0_1px_6px_rgba(0,0,0,0.9)]"
          >
            <ArrowLeft className="size-7" />
          </button>
        </header>
      );
    }

    // Every screen but Home is a category: back arrow and the section name,
    // and no chip row at all. The app only shows its chips on Home — carrying
    // them into Shows or New & Hot is not something it does.
    if (!isHome) {
      return (
        <header className="sticky top-0 z-50 -mx-[var(--main-pad-x)] px-[var(--main-pad-x)] pt-1 pb-2">
          <span
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-0 -z-10 transition-opacity duration-300',
              scrolled ? 'bg-[#141414] opacity-100' : 'opacity-0',
            )}
          />
          <div className="flex items-center gap-2 py-1">
            <button
              type="button"
              aria-label="Go back"
              onClick={() => router.back()}
              className="-ml-2 flex size-10 shrink-0 items-center justify-center text-white"
            >
              <ArrowLeft className="size-7" />
            </button>
            <span className="min-w-0 truncate text-[26px] font-bold text-white">
              {sectionLabel ?? nameParam ?? 'Watch'}
            </span>
            <span className="ml-auto flex items-center gap-4">
              <Link href="/jellyfin/library/search" aria-label="Search" className="text-white">
                <Search className="size-[22px]" />
              </Link>
              <Link href={exitHref} aria-label="Leave the Watch section" className="text-white">
                <LogOut className="size-[22px]" />
              </Link>
            </span>
          </div>
        </header>
      );
    }

    // The app puts its header above the hero card, not over it: a wordmark row
    // and then a row of chips. Overlaying a portrait poster the way the
    // desktop billboard is overlaid buries the artwork's own title.
    //
    // Transparent, not a solid band: the ambient wash the hero paints runs up
    // behind the header on the app's home, and a #141414 bar cut straight
    // across it.
    return (
      <header className="sticky top-0 z-50 -mx-[var(--main-pad-x)] px-[var(--main-pad-x)] pt-1 pb-2">
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 -z-10 transition-opacity duration-300',
            scrolled ? 'bg-[#141414] opacity-100' : 'opacity-0',
          )}
        />
        <div className="flex items-center gap-3 py-1">
          <Link
            href="/jellyfin/library"
            aria-label="Watch home"
            className="text-xl font-extrabold tracking-[-0.04em] text-[#e50914] uppercase"
          >
            Helprr
          </Link>
          {/* The app names the screen in the bar itself, beside the mark. */}
          {sectionLabel && (
            <span className="min-w-0 truncate text-[22px] font-medium text-white">{sectionLabel}</span>
          )}
          <span className="ml-auto flex items-center gap-4">
            <Link href="/jellyfin/library/search" aria-label="Search" className="text-white">
              <Search className="size-[22px]" />
            </Link>
            <Link href={exitHref} aria-label="Leave the Watch section" className="text-white">
              <LogOut className="size-[22px]" />
            </Link>
          </span>
        </div>

        {/* Rendered only once the libraries have resolved. Building it from a
            partial list and then splicing TV Shows and Movies in at position
            two made every chip after them jump. */}
        {navReady && (
          <nav
            ref={chipsRef}
            aria-label="Watch sections"
            className="flex items-center gap-2 overflow-x-auto pt-1 scrollbar-hide"
          >
            {entries.map((entry) => {
              const active = entry.isActive(pathname);
              return (
                <Link
                  key={entry.label}
                  href={entry.href}
                  ref={active ? activeChipRef : undefined}
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
        )}
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
              // The site marks the current section with a filled pill behind
              // the label, not weight alone.
              className={cn(
                'shrink-0 rounded-full px-3 py-1.5 text-sm whitespace-nowrap transition-colors md:text-base',
                active
                  ? 'bg-white/15 font-medium text-white'
                  : 'font-normal text-[#e5e5e5] hover:text-[#b3b3b3]',
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
        {/* The site's right cluster is search, bell, avatar. Helprr has real
            destinations for both, and keeps Exit on the end — there is no way
            out of a full-screen skin otherwise. */}
        <Link href="/notifications" aria-label="Notifications" title="Notifications" className="text-white transition-opacity hover:opacity-80">
          <Bell className="size-5" />
        </Link>
        <Link
          href="/settings"
          aria-label="Account"
          title={me?.name ?? 'Account'}
          className="flex size-7 items-center justify-center rounded bg-[#e50914] text-[13px] font-semibold text-white transition-opacity hover:opacity-80"
        >
          {(me?.name ?? '?').slice(0, 1).toUpperCase()}
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

  // Search carries no page title on the site — the field is the whole header.
  const label = pathname.startsWith('/jellyfin/library/new') ? 'New & Popular'
    : pathname.startsWith('/jellyfin/library/favorites') ? 'My List'
    : pathname.startsWith('/jellyfin/library/browse') ? 'Browse'
      : pathname.startsWith('/jellyfin/library/live') ? 'Live TV'
        : null;

  // Detail pages have their own hero, so they only need the clearance.
  if (!label) return clearance;

  // A <p>, not a second <h1>: every Watch page already carries its own
  // sr-only <h1> with this exact text, so an <h1> here left two of them in the
  // landmark tree. aria-hidden keeps it out of the accessible name entirely.
  //
  // Hidden on phones, where the masthead already names the screen beside the
  // wordmark; the desktop bar carries only the nav links.
  return (
    <p
      aria-hidden
      className="hidden pt-4 pb-4 text-2xl font-medium tracking-tight md:block md:pt-[5.5rem] md:text-3xl"
    >
      {label}
    </p>
  );
}
