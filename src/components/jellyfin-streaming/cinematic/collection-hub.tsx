'use client';

import { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { PageSpinner } from '@/components/ui/page-spinner';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CatalogRail } from '@/components/jellyfin-streaming/catalog-rail';
import { WatchHero } from '@/components/jellyfin-streaming/watch-hero';
import { UpcomingRails } from '@/components/jellyfin-streaming/upcoming-rails';
import { RecommendationRails } from '@/components/jellyfin-streaming/recommendation-rails';
import { useCompactViewport } from '@/lib/hooks/use-compact-viewport';
import { cn } from '@/lib/utils';
import { useJellyfinPlayback } from '@/components/jellyfin-streaming/playback-provider';
import type {
  CatalogFiltersResponse,
  CatalogHomeResponse,
  CatalogItemsResponse,
} from '@/types/jellyfin-streaming';
import type { JellyfinItem } from '@/types/jellyfin';

/**
 * How many genres to ask about, and how many rails to actually show.
 *
 * These differ because rails that cannot fill a row are dropped
 * (MIN_RAIL_ITEMS) and, measured against a real library, roughly four in ten
 * are: of this server's first ten TV genres, Adventure and Fantasy hold nothing
 * at all, Anime holds two and Documentary three. Asking for exactly as many as
 * we want to display therefore left the page short — and because Jellyfin
 * returns genres alphabetically, it also meant the page could only ever show
 * A-to-H and never reached Mystery, Romance or Sci-Fi.
 */
const GENRE_QUERIES = 14;
const GENRE_RAILS_SHOWN = 8;
const RAIL_SIZE = 20;
/**
 * The fewest titles a genre rail may have.
 *
 * A row that stops two cards in is worse than no row: it reads as a broken
 * rail rather than as a small genre, and it costs a heading and 150px of page
 * to say nothing. Six fills a 1440px row (five 262px tiles plus the gap) with
 * one card to scroll to, so every rail on the page is a real rail.
 *
 * A genre picked explicitly from the menu is exempt — that is the viewer
 * asking for that genre by name, and answering "nothing here" when there are
 * two titles would be a lie.
 */
const MIN_RAIL_ITEMS = 6;

/** Enough rails to look like a loading page rather than a broken one. */
const SKELETON_RAILS = 3;

/**
 * What the rail area should render: its rails, a loading state, or "nothing
 * here".
 *
 * Extracted because the old inline version had a bug that is invisible when you
 * read it and obvious when you run it. It was:
 *
 *   rails.every((r) => r.items.length === 0) && !rails.some((r) => r.isPending)
 *
 * and `rails` is an empty array until the *genre list* arrives — so on every
 * switch to Shows or Movies both halves were vacuously true (`[].every()` is
 * true, `[].some()` is false) and the page announced "Nothing to show here yet"
 * for the split second before it had asked anything. An empty answer is only an
 * answer once the questions have been asked, which is what `askedEverything`
 * carries.
 */
export function hubRailState({
  askedEverything,
  railsPending,
  hasAnything,
  builtRails,
}: {
  /** Every query the rails are derived from has succeeded. */
  askedEverything: boolean;
  /** At least one genre rail is still in flight. */
  railsPending: boolean;
  /** Anything at all resolved — a hero, a rail, a resume row. */
  hasAnything: boolean;
  /** How many rails already have content to show. */
  builtRails: number;
}): 'rails' | 'loading' | 'empty' {
  if (askedEverything && !railsPending) return hasAnything ? 'rails' : 'empty';
  // Something already resolved, so show it rather than covering it with
  // placeholders; the rest fills in underneath.
  return builtRails > 0 || hasAnything ? 'rails' : 'loading';
}

/**
 * A library presented the way the site presents TV Shows and Movies: a
 * billboard, the rails a viewer actually navigates by, and genre rails under
 * them.
 *
 * Deliberately *not* the paginated grid at /v/[libraryId]. That grid is the
 * "show me everything" view and stays reachable through Browse; these two
 * pages are for wandering, which is a different job and a different shape.
 */
export function CollectionHub({
  title,
  collectionType,
  includeItemTypes,
}: {
  title: string;
  /** Jellyfin CollectionType to find the owner's library by. */
  collectionType: string;
  /** What counts as a title here — Series for shows, Movie for films. */
  includeItemTypes: string;
}) {
  const playback = useJellyfinPlayback();
  const compact = useCompactViewport();
  const [genre, setGenre] = useState<string | null>(null);
  const isShows = includeItemTypes === 'Series';

  const home = useQuery({
    queryKey: queryKeys.jellyfinHome(),
    queryFn: jsonFetcher<CatalogHomeResponse>('/api/jellyfin/catalog/home'),
  });

  const library = useMemo(
    () => (home.data?.views ?? []).find(
      (view) => (view.CollectionType || '').toLowerCase() === collectionType,
    ),
    [home.data?.views, collectionType],
  );
  const parentId = library?.Id;

  const filters = useQuery({
    queryKey: ['jellyfin', 'catalog', 'filters', parentId],
    queryFn: jsonFetcher<CatalogFiltersResponse>(`/api/jellyfin/catalog/filters?parentId=${parentId}`),
    enabled: Boolean(parentId),
    staleTime: 30 * 60_000,
  });

  const spotlight = useQuery({
    queryKey: ['jellyfin', 'catalog', 'hub-spotlight', parentId, includeItemTypes],
    queryFn: jsonFetcher<CatalogItemsResponse>(
      `/api/jellyfin/catalog/items?parentId=${parentId}&includeItemTypes=${includeItemTypes}&recursive=true&sortBy=Random&limit=24`,
    ),
    enabled: Boolean(parentId),
    staleTime: 10 * 60_000,
  });

  /**
   * The two sorted rails the section needs beyond "recently added": what came
   * out most recently, and what the library rates highest. Both are one request
   * each and neither is derivable from the home payload, which only carries
   * DateCreated order.
   */
  const sorted = useQueries({
    queries: (['PremiereDate', 'CommunityRating'] as const).map((sortBy) => ({
      queryKey: ['jellyfin', 'catalog', 'hub-sorted', parentId, includeItemTypes, sortBy],
      queryFn: jsonFetcher<CatalogItemsResponse>(
        `/api/jellyfin/catalog/items?parentId=${parentId}&includeItemTypes=${includeItemTypes}`
        + `&recursive=true&sortBy=${sortBy}&sortOrder=Descending&limit=${RAIL_SIZE}`,
      ),
      enabled: Boolean(parentId),
      staleTime: 10 * 60_000,
    })),
  });
  const [released, topRated] = sorted;

  // Memoised so the fallback array is not a fresh identity every render, which
  // would re-key the rail queries below on each pass.
  const genres = useMemo(() => filters.data?.genres ?? [], [filters.data?.genres]);
  const railGenres = useMemo(
    () => (genre ? [genre] : genres.slice(0, GENRE_QUERIES)),
    [genre, genres],
  );

  const rails = useQueries({
    queries: railGenres.map((name) => ({
      queryKey: ['jellyfin', 'catalog', 'hub-rail', parentId, includeItemTypes, name],
      queryFn: jsonFetcher<CatalogItemsResponse>(
        `/api/jellyfin/catalog/items?parentId=${parentId}&includeItemTypes=${includeItemTypes}`
        + `&recursive=true&genres=${encodeURIComponent(name)}&sortBy=CommunityRating&sortOrder=Descending&limit=${RAIL_SIZE}`,
      ),
      enabled: Boolean(parentId),
      staleTime: 10 * 60_000,
    })),
  });

  if (home.isPending && !home.data) return <PageSpinner />;
  if (home.isError) {
    return <ErrorState message={`Couldn't load ${title}.`} onRetry={() => void home.refetch()} />;
  }
  if (!library) {
    return <p className="py-8 text-sm text-muted-foreground">No {title} library on this Jellyfin server.</p>;
  }

  const play = (item: JellyfinItem) => void playback.playItem(item);
  // The billboard wants artwork it can actually fill a wide frame with.
  const heroItems = (spotlight.data?.items ?? [])
    .filter((item) => (item.BackdropImageTags?.length ?? 0) > 0 && Boolean(item.Overview))
    .slice(0, 1);

  /**
   * Continue watching and Next Up, narrowed to this library.
   *
   * Both come from the home payload, so they cost nothing extra here. Jellyfin
   * resume entries do not carry their library id, so the filter is on type,
   * which is exact for these two pages: a shows library resumes episodes and a
   * movies library resumes movies.
   */
  const resume = (home.data?.resume ?? []).filter((item) => (isShows
    ? item.Type === 'Episode' || item.Type === 'Series'
    : item.Type === 'Movie'));
  const nextUp = isShows ? (home.data?.nextUp ?? []) : [];
  const recentlyAdded = (home.data?.latest ?? []).find((row) => row.libraryId === parentId)?.items ?? [];

  const libraryHref = `/jellyfin/library/v/${library.Id}?name=${encodeURIComponent(library.Name)}`
    + `&type=${encodeURIComponent(library.CollectionType || collectionType)}`;

  // A genre picked by name is shown whatever its size; the automatic set has to
  // earn its row.
  const minItems = genre ? 1 : MIN_RAIL_ITEMS;
  const genreRails = railGenres
    .map((name, index) => ({ name, items: rails[index]?.data?.items ?? [] }))
    .filter((rail) => rail.items.length >= minItems)
    .slice(0, GENRE_RAILS_SHOWN);

  const hasAnything = heroItems.length > 0
    || genreRails.length > 0
    || resume.length > 0
    || nextUp.length > 0
    || recentlyAdded.length > 0
    || (released.data?.items?.length ?? 0) > 0;
  const railState = hubRailState({
    askedEverything: filters.isSuccess && spotlight.isSuccess,
    railsPending: rails.some((rail) => rail.isPending),
    hasAnything,
    builtRails: genreRails.length,
  });

  // The app puts a rounded "All Categories" pill directly under the header and
  // *above* the hero on a phone, and never repeats the screen name below it —
  // the header already carries it. Desktop keeps the title beside the picker.
  /**
   * A stand-in the exact size of the trigger, while the genre list is in
   * flight.
   *
   * Rendering nothing until the filters call answered dropped a control in
   * above the rails a couple of seconds late and pushed the whole page down by
   * its height — the last of the jumps on this screen. Only shown while the
   * query is pending, so a library with no genres still takes no space.
   */
  const pickerPlaceholder = genres.length === 0 && filters.isPending && (
    <Skeleton
      className={cn(
        'w-32',
        compact ? 'h-[34px] rounded-full' : 'h-[34px] rounded-none',
      )}
    />
  );

  const picker = genres.length > 0 && (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex items-center gap-2 text-white transition-colors',
          compact
            ? 'rounded-full border border-white/50 px-4 py-1.5 text-[15px] hover:border-white'
            : 'border border-white/40 bg-black/40 px-3 py-1.5 text-sm hover:border-white',
        )}
      >
        {genre ?? (compact ? 'All Categories' : 'Genres')}
        <ChevronDown className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
        <DropdownMenuItem onSelect={() => setGenre(null)}>All genres</DropdownMenuItem>
        {genres.map((name) => (
          <DropdownMenuItem key={name} onSelect={() => setGenre(name)}>
            {name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="pb-28">
      <h1 className="sr-only">{title}</h1>

      {/* Centred, not left-aligned. The header row above already carries the
          back arrow, the section name and two icons; a 150px pill will not fit
          beside them on a 360px phone without truncating the name, so it takes
          its own row and centres there. */}
      {compact && <div className="mb-3 flex justify-center">{picker}{pickerPlaceholder}</div>}

      <WatchHero items={heroItems} onPlay={play} pending={spotlight.isPending} />

      {!compact && (
      <div className="mb-4 flex items-center gap-4">
        <h2 className="text-2xl font-medium tracking-tight md:text-3xl">{title}</h2>
        {picker}{pickerPlaceholder}
      </div>
      )}

      <div className="space-y-6">
        {/* Everything a viewer navigates by comes before the genre rails, which
            is the order the site uses on both of these screens. */}
        <CatalogRail
          shape="landscape"
          identity="series"
          title="Continue watching"
          items={resume}
          onPlay={play}
        />
        <CatalogRail
          shape="landscape"
          identity="series"
          title="Next up"
          items={nextUp}
          onPlay={play}
        />
        <CatalogRail
          shape="landscape"
          title={`Recently added ${isShows ? 'shows' : 'movies'}`}
          href={libraryHref}
          items={recentlyAdded}
          onPlay={play}
        />
        <CatalogRail
          shape="landscape"
          title={isShows ? 'Recently premiered' : 'Recently released'}
          href={libraryHref}
          items={released.data?.items ?? []}
          onPlay={play}
        />
        <CatalogRail
          shape="landscape"
          title="Top rated"
          href={libraryHref}
          items={topRated.data?.items ?? []}
          onPlay={play}
        />

        {/* Both of these already drop themselves when they have nothing, and
            both are filtered to this screen's medium — a Movies page carrying
            "Airing this week" was the reason they were left off entirely. */}
        <UpcomingRails only={isShows ? 'episode' : 'movie'} />
        <RecommendationRails mediaType={isShows ? 'tv' : 'movie'} limit={4} />

        {genreRails.map((rail) => (
          <CatalogRail
            key={rail.name}
            shape="landscape"
            title={rail.name}
            items={rail.items}
            onPlay={play}
            href={libraryHref}
          />
        ))}

        {/* While the library is still answering, the page says so. */}
        {railState === 'loading' && <HubSkeleton />}

        {railState === 'empty' && (
          <p className="text-sm text-muted-foreground">Nothing to show here yet.</p>
        )}
      </div>
    </div>
  );
}

/**
 * Loading rails.
 *
 * A spinner is wrong here: the shell of the page — billboard, title, picker —
 * has already painted from cache, so the only thing missing is the rows, and
 * their shape is known. Matching the real rail's heading and tile geometry
 * means nothing moves when the data lands.
 */
function HubSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      {Array.from({ length: SKELETON_RAILS }, (_, railIndex) => (
        <div key={railIndex} className="space-y-3">
          <Skeleton className="h-6 w-40" />
          <div className="-mx-[var(--main-pad-x)] flex gap-2 overflow-hidden px-[var(--main-pad-x)]">
            {Array.from({ length: 8 }, (_, tileIndex) => (
              <Skeleton
                key={tileIndex}
                className="aspect-2/3 w-[112px] shrink-0 sm:aspect-video sm:w-[196px] md:w-[220px] lg:w-[240px] xl:w-[262px] 2xl:w-[292px]"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
