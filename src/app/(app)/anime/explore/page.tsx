'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRestorableInfiniteQuery as useInfiniteQuery } from '@/lib/hooks/use-restorable-infinite-query';
import { jsonFetcher } from '@/lib/query-fetch';
import Link from '@/components/ui/app-link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { SearchBar } from '@/components/media/search-bar';
import { AnimeCard } from '@/components/anime/anime-card';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { PageSpinner } from '@/components/ui/page-spinner';
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DEFAULT_ANIME_FILTERS, type AnimeFiltersState, useUIStore } from '@/lib/store';
import { ActiveFilterBar, type ActiveFilter } from '@/components/ui/active-filter-bar';
import { exploreHref, exploreLinkView, type ExploreView } from './_components/link-view';
import {
  ArrowDownAZ,
  CalendarDays,
  ChevronLeft,
  Clock,
  Filter,
  Heart,
  Loader2,
  Star,
  TrendingUp,
  X,
  Check,
} from 'lucide-react';
import type { AniListListItem, AniListMediaFormat, AniListMediaSeason, AniListPageInfo } from '@/types/anilist';
import type { DiscoverLibraryStatus } from '@/types';

type AnimeItemWithLibrary = AniListListItem & { library?: DiscoverLibraryStatus };

interface ListResponse {
  mode: 'browse' | 'search';
  items: AnimeItemWithLibrary[];
  pageInfo: AniListPageInfo | null;
}

const SORT_OPTIONS = [
  { value: 'seasonal', label: 'Seasonal', icon: CalendarDays },
  { value: 'trending', label: 'Trending', icon: TrendingUp },
  { value: 'popularity', label: 'Popular', icon: Heart },
  { value: 'score', label: 'Score', icon: Star },
  { value: 'title', label: 'Title', icon: ArrowDownAZ },
  { value: 'date_added', label: 'Date Added', icon: Clock },
  { value: 'release_date', label: 'Release Date', icon: CalendarDays },
];

const FORMAT_OPTIONS: { value: AniListMediaFormat; label: string }[] = [
  { value: 'TV', label: 'TV' },
  { value: 'MOVIE', label: 'Movie' },
  { value: 'OVA', label: 'OVA' },
  { value: 'ONA', label: 'ONA' },
  { value: 'SPECIAL', label: 'Special' },
  { value: 'TV_SHORT', label: 'TV Short' },
];

const SEASON_OPTIONS: { value: AniListMediaSeason; label: string }[] = [
  { value: 'WINTER', label: 'Winter' },
  { value: 'SPRING', label: 'Spring' },
  { value: 'SUMMER', label: 'Summer' },
  { value: 'FALL', label: 'Fall' },
];

const ALL_GENRES = [
  'Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy',
  'Horror', 'Mahou Shoujo', 'Mecha', 'Music', 'Mystery', 'Psychological',
  'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller',
];

// Only a searchable (≥3 char) ?search= restores search mode — a 1–2 char one
// would enable neither list (searchInfinite needs ≥3, browse is off in search
// mode) and strand the page on an empty search view.
function searchFromUrl(params: URLSearchParams) {
  const search = params.get('search');
  return search && search.trim().length >= 3 ? search : '';
}

function statusLabel(status: string) {
  return status === 'NOT_YET_RELEASED' ? 'Upcoming' : status.charAt(0) + status.slice(1).toLowerCase();
}

const YEAR_OPTIONS: number[] = (() => {
  const end = new Date().getFullYear() + 5;
  const years: number[] = [];
  for (let y = end; y >= 1940; y--) years.push(y);
  return years;
})();

export default function AnimePage() {
  const urlParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const savedSort = useUIStore((s) => s.animeSort);
  const setAnimeSort = useUIStore((s) => s.setAnimeSort);
  const savedFilters = useUIStore((s) => s.animeFilters);
  const setAnimeFilters = useUIStore((s) => s.setAnimeFilters);
  const hasHydrated = useUIStore((s) => s.hasHydrated);

  // A "View all" link (?sort=trending, ?season=FALL&year=…) opens its own view.
  // It never touches the saved filters, so following one can't leave every
  // later plain visit filtered. Changes made on it stay with it, mirrored into
  // its URL below; only a plain visit's changes are saved. Local state is the
  // render source so an edit shows at once (the URL catches up a navigation
  // later); it is re-read whenever the URL changes, e.g. the nav item or back.
  const urlKey = urlParams.toString();
  const [linkView, setLinkView] = useState(() => exploreLinkView(urlParams));
  const [linkViewUrlKey, setLinkViewUrlKey] = useState(urlKey);
  if (linkViewUrlKey !== urlKey) {
    setLinkViewUrlKey(urlKey);
    setLinkView(exploreLinkView(urlParams));
  }
  const animeSort = linkView ? linkView.sort : savedSort;
  const animeFilters = linkView ? linkView.filters : savedFilters;

  // The search and a link view's sort/filters are restored on back-nav from the
  // URL (write-back effect below keeps them there); list data is restored from the
  // TanStack query cache (gcTime), replacing the bespoke media-list-cache data.
  const [viewMode, setViewMode] = useState<'browse' | 'search'>(() => (searchFromUrl(urlParams) ? 'search' : 'browse'));
  const [searchQuery, setSearchQuery] = useState(() => searchFromUrl(urlParams));
  const [debouncedQuery, setDebouncedQuery] = useState(() => searchFromUrl(urlParams).trim());
  const [filterOpen, setFilterOpen] = useState(false);

  // Keep the search and a link view's sort/filters in the current history
  // entry, so back-navigation and reload return to them. scroll: false keeps
  // the list where it is while typing or removing a chip.
  useEffect(() => {
    const trimmedSearch = viewMode === 'search' ? searchQuery.trim() : '';
    const target = exploreHref(pathname, linkView, trimmedSearch);
    if (target !== `${window.location.pathname}${window.location.search}`) {
      router.replace(target, { scroll: false });
    }
  }, [viewMode, searchQuery, linkView, pathname, router]);

  // A plain visit's changes are saved; a link view's stay with it.
  const updateBrowse = (next: ExploreView) => {
    if (linkView) {
      setLinkView(next);
      return;
    }
    setAnimeSort(next.sort);
    setAnimeFilters(next.filters);
  };

  // Seeded from the active sort/filters each time the drawer opens.
  const [draftFilters, setDraftFilters] = useState<AnimeFiltersState>(animeFilters);
  const [draftSort, setDraftSort] = useState(animeSort);

  const sentinelRef = useRef<HTMLDivElement>(null);

  const activeFilterCount =
    animeFilters.genres.length
    + (animeFilters.year !== '' ? 1 : 0)
    + (animeFilters.yearMin !== '' || animeFilters.yearMax !== '' ? 1 : 0)
    + (animeFilters.season !== '' ? 1 : 0)
    + animeFilters.formats.length
    + (animeFilters.status !== '' ? 1 : 0);

  const hasFilters = activeFilterCount > 0;

  const buildBrowseParams = useCallback((page: number) => {
    const params = new URLSearchParams({ mode: 'browse', page: String(page), sort: animeSort });
    if (animeFilters.genres.length) params.set('genres', animeFilters.genres.join(','));
    if (animeFilters.formats.length) params.set('format', animeFilters.formats.join(','));
    if (animeFilters.status) params.set('status', animeFilters.status);
    if (animeFilters.year) params.set('year', animeFilters.year);
    if (animeFilters.yearMin) params.set('yearMin', animeFilters.yearMin);
    if (animeFilters.yearMax) params.set('yearMax', animeFilters.yearMax);
    if (animeFilters.season) params.set('season', animeFilters.season);
    return params;
  }, [animeSort, animeFilters]);

  // Debounce the search box into the query key, and switch to search mode once a
  // searchable (≥3 char) query is committed. 1–2 char input keeps the last
  // results (matches old behavior); emptying the box falls back to browse (onChange).
  useEffect(() => {
    const t = window.setTimeout(() => {
      const q = searchQuery.trim();
      if (q.length >= 3) {
        setDebouncedQuery(q);
        setViewMode('search');
      } else if (q.length === 0) {
        setDebouncedQuery('');
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [searchQuery]);

  const searchActive = viewMode === 'search' && debouncedQuery.length >= 3;
  const queriesReady = hasHydrated;

  // Browse + search lists. The query key carries the full state, so the cache +
  // staleTime (5m) replace the bespoke data cache, signature check and freshness
  // check; gcTime gives instant back-nav paint.
  const browseInfinite = useInfiniteQuery({
    queryKey: ['anime', 'list', 'browse', animeSort, animeFilters],
    queryFn: ({ pageParam, signal }) =>
      jsonFetcher<ListResponse>(`/api/anime?${buildBrowseParams(pageParam).toString()}`)({ signal }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.pageInfo?.hasNextPage ? (last.pageInfo.currentPage || 1) + 1 : undefined),
    enabled: queriesReady && viewMode === 'browse',
    staleTime: 5 * 60_000,
  });
  const searchInfinite = useInfiniteQuery({
    queryKey: ['anime', 'list', 'search', debouncedQuery],
    queryFn: ({ pageParam, signal }) =>
      jsonFetcher<ListResponse>(
        `/api/anime?${new URLSearchParams({ mode: 'search', q: debouncedQuery, page: String(pageParam) }).toString()}`,
      )({ signal }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.pageInfo?.hasNextPage ? (last.pageInfo.currentPage || 1) + 1 : undefined),
    enabled: queriesReady && searchActive,
    staleTime: 5 * 60_000,
  });

  const active = viewMode === 'search' ? searchInfinite : browseInfinite;
  const items = useMemo<AnimeItemWithLibrary[]>(
    () => active.data?.pages.flatMap((p) => p.items) ?? [],
    [active.data],
  );
  const loading =
    active.isLoading && active.data === undefined;
  const initialError = active.isError && active.data === undefined;
  const loadingMore = active.isFetchingNextPage;
  const {
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    isLoading: activeIsLoading,
    fetchNextPage,
  } = active;

  // Infinite scroll — fetch the active query's next page when the sentinel shows.
  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0]?.isIntersecting
          && hasNextPage
          && !isFetchingNextPage
          && !isFetchNextPageError
          && !activeIsLoading
        ) {
          void fetchNextPage();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    activeIsLoading,
    fetchNextPage,
  ]);

  const resetExploreScroll = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  const handleSortChange = (sort: string) => {
    if (sort === animeSort && viewMode === 'browse') return;
    updateBrowse({ sort, filters: animeFilters });
    setSearchQuery('');
    setViewMode('browse');
    resetExploreScroll();
  };

  const applyFilters = () => {
    updateBrowse({ sort: draftSort, filters: draftFilters });
    setFilterOpen(false);
    setSearchQuery('');
    setViewMode('browse');
    resetExploreScroll();
  };

  const clearFilters = () => {
    updateBrowse({ sort: 'seasonal', filters: DEFAULT_ANIME_FILTERS });
    setDraftFilters(DEFAULT_ANIME_FILTERS);
    setDraftSort('seasonal');
    setViewMode('browse');
    setFilterOpen(false);
    resetExploreScroll();
  };

  const removeFilter = (next: Partial<AnimeFiltersState>) => () =>
    updateBrowse({ sort: animeSort, filters: { ...animeFilters, ...next } });
  const { genres, year, yearMin, yearMax, season, formats, status } = animeFilters;
  const activeFilters: ActiveFilter[] = [
    ...genres.map((genre) => ({
      id: `genre:${genre}`,
      label: genre,
      onRemove: removeFilter({ genres: genres.filter((g) => g !== genre) }),
    })),
    ...(year ? [{ id: 'year', label: year, onRemove: removeFilter({ year: '' }) }] : []),
    ...(yearMin || yearMax
      ? [{
        id: 'yearRange',
        label: yearMin && yearMax ? `${yearMin}–${yearMax}` : yearMin ? `${yearMin}+` : `≤ ${yearMax}`,
        onRemove: removeFilter({ yearMin: '', yearMax: '' }),
      }]
      : []),
    ...(season
      ? [{ id: 'season', label: SEASON_OPTIONS.find((o) => o.value === season)?.label ?? season, onRemove: removeFilter({ season: '' }) }]
      : []),
    ...formats.map((format) => ({
      id: `format:${format}`,
      label: FORMAT_OPTIONS.find((o) => o.value === format)?.label ?? format,
      onRemove: removeFilter({ formats: formats.filter((f) => f !== format) }),
    })),
    ...(status ? [{ id: 'status', label: statusLabel(status), onRemove: removeFilter({ status: '' }) }] : []),
  ];

  if (!hasHydrated) {
    return <PageSpinner />;
  }

  return (
    <div className="animate-content-in">
      {/* Back to Anime */}
      <Link
        href="/anime"
        className="inline-flex items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground transition-colors pt-2 pb-1"
      >
        <ChevronLeft className="h-4 w-4" />
        Anime
      </Link>

      {/* Sticky search + sort/filter toolbar */}
      <div className="page-toolbar pt-1 pb-2 app-chrome-bar bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 space-y-1">
        <SearchBar
          value={searchQuery}
          onChange={(value) => {
            setSearchQuery(value);
            if (!value.trim()) setViewMode('browse');
          }}
          placeholder="Search anime..."
          historyKey="anime-explore"
        />

        {/* Sort pills + Filter button */}
        {viewMode !== 'search' && (
          <div className="rail-bleed py-2 flex gap-2 overflow-x-auto scrollbar-hide">
            <Button
              variant={hasFilters ? 'default' : 'outline'}
              size="sm"
              className="shrink-0 gap-1.5 h-8 text-xs relative"
              onClick={() => {
                setDraftFilters(animeFilters);
                setDraftSort(animeSort);
                setFilterOpen(true);
              }}
            >
              <Filter className="h-3 w-3" />
              {activeFilterCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-primary text-primary-foreground text-[9px] font-bold rounded-full h-4 w-4 flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </Button>
            {SORT_OPTIONS.map((opt) => {
              const active = animeSort === opt.value;
              return (
                <Button
                  key={opt.value}
                  variant={active ? 'default' : 'outline'}
                  size="sm"
                  className="shrink-0 gap-1.5 h-8 text-xs"
                  onClick={() => handleSortChange(opt.value)}
                >
                  <opt.icon className="h-3 w-3" />
                  {opt.label}
                </Button>
              );
            })}
          </div>
        )}
      </div>

      {viewMode !== 'search' && (
        <ActiveFilterBar
          filters={activeFilters}
          onClearAll={() => updateBrowse({ sort: animeSort, filters: DEFAULT_ANIME_FILTERS })}
          className="pt-2"
        />
      )}

      {/* Content */}
      {loading ? (
        <PageSpinner />
      ) : initialError ? (
        <ErrorState
          message="Couldn't load anime. Try again."
          onRetry={() => void active.refetch()}
          retrying={active.isFetching}
        />
      ) : (
        <div className="pt-2">
          {items.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">No results found</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
              {items.map((item, i) => (
                <AnimeCard
                  key={item.id}
                  item={item}
                  grid
                  imagePriority={i < 4}
                />
              ))}
            </div>
          )}
          <div ref={sentinelRef} className="h-4" />
          {loadingMore && (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {isFetchNextPageError && (
            <ErrorState
              message="Couldn't load more results."
              onRetry={() => {
                if (hasNextPage && !isFetchingNextPage) {
                  void fetchNextPage();
                }
              }}
              retrying={isFetchingNextPage}
              compact
            />
          )}
        </div>
      )}

      {/* Filter Drawer */}
      <Drawer open={filterOpen} onOpenChange={setFilterOpen}>
        <DrawerContent className="max-h-[95dvh]">
          <DrawerHeader className="sr-only">
            <DrawerTitle>Filters</DrawerTitle>
          </DrawerHeader>
          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
            <div className="space-y-3">
              {/* Sort */}
              <div>
                <label className="text-sm font-medium mb-1.5 block">Sort</label>
                <div className="grid grid-cols-2 gap-2">
                  {SORT_OPTIONS.map((opt) => {
                    const active = draftSort === opt.value;
                    return (
                      <Button
                        key={opt.value}
                        variant={active ? 'default' : 'outline'}
                        size="sm"
                        className="h-8 text-xs gap-1.5 justify-start"
                        onClick={() => setDraftSort(opt.value)}
                      >
                        <opt.icon className="h-3 w-3" />
                        {opt.label}
                      </Button>
                    );
                  })}
                </div>
              </div>

              <div className="border-t border-border" />

              {/* Format */}
              <div>
                <label className="text-sm font-medium mb-1.5 block">Format</label>
                <div className="flex flex-wrap gap-2">
                  {FORMAT_OPTIONS.map((f) => {
                    const active = draftFilters.formats.includes(f.value);
                    return (
                      <Button
                        key={f.value}
                        variant={active ? 'default' : 'outline'}
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          setDraftFilters((prev) => ({
                            ...prev,
                            formats: active
                              ? prev.formats.filter((x) => x !== f.value)
                              : [...prev.formats, f.value],
                          }));
                        }}
                      >
                        {f.label}
                      </Button>
                    );
                  })}
                </div>
              </div>

              <div className="border-t border-border" />

              {/* Year */}
              <div>
                <label className="text-sm font-medium mb-1.5 block">Year</label>
                <Select
                  value={draftFilters.year || 'any'}
                  onValueChange={(v) => setDraftFilters((prev) => ({
                    ...prev,
                    year: v === 'any' ? '' : v,
                    yearMin: '',
                    yearMax: '',
                  }))}
                >
                  <SelectTrigger className="w-full h-9 mb-2">
                    <SelectValue placeholder="Any year" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any year</SelectItem>
                    {YEAR_OPTIONS.map((y) => (
                      <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">Or specify a range:</span>
                <div className="flex items-center gap-2">
                  <Select
                    value={draftFilters.yearMin || 'any'}
                    onValueChange={(v) => setDraftFilters((prev) => ({
                      ...prev,
                      yearMin: v === 'any' ? '' : v,
                      year: '',
                    }))}
                  >
                    <SelectTrigger className="w-full h-9">
                      <SelectValue placeholder="Min Year" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Min Year</SelectItem>
                      {YEAR_OPTIONS.map((y) => (
                        <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={draftFilters.yearMax || 'any'}
                    onValueChange={(v) => setDraftFilters((prev) => ({
                      ...prev,
                      yearMax: v === 'any' ? '' : v,
                      year: '',
                    }))}
                  >
                    <SelectTrigger className="w-full h-9">
                      <SelectValue placeholder="Max Year" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Max Year</SelectItem>
                      {YEAR_OPTIONS.map((y) => (
                        <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="border-t border-border" />

              {/* Season */}
              <div>
                <label className="text-sm font-medium mb-1.5 block">Season</label>
                <div className="flex flex-wrap gap-2">
                  {SEASON_OPTIONS.map((s) => {
                    const active = draftFilters.season === s.value;
                    return (
                      <Button
                        key={s.value}
                        variant={active ? 'default' : 'outline'}
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          setDraftFilters((prev) => ({
                            ...prev,
                            season: active ? '' : s.value,
                          }));
                        }}
                      >
                        {s.label}
                      </Button>
                    );
                  })}
                </div>
              </div>

              <div className="border-t border-border" />

              {/* Status */}
              <div>
                <label className="text-sm font-medium mb-1.5 block">Status</label>
                <div className="flex flex-wrap gap-2">
                  {(['FINISHED', 'RELEASING', 'NOT_YET_RELEASED'] as const).map((st) => {
                    const active = draftFilters.status === st;
                    const label = statusLabel(st);
                    return (
                      <Button
                        key={st}
                        variant={active ? 'default' : 'outline'}
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          setDraftFilters((prev) => ({
                            ...prev,
                            status: active ? '' : st,
                          }));
                        }}
                      >
                        {label}
                      </Button>
                    );
                  })}
                </div>
              </div>

              <div className="border-t border-border" />

              {/* Genres */}
              <div>
                <label className="text-sm font-medium mb-1.5 block">Genres</label>
                <div className="flex flex-wrap gap-2">
                  {ALL_GENRES.map((genre) => {
                    const active = draftFilters.genres.includes(genre);
                    return (
                      <Button
                        key={genre}
                        variant={active ? 'default' : 'outline'}
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          setDraftFilters((prev) => ({
                            ...prev,
                            genres: active
                              ? prev.genres.filter((g) => g !== genre)
                              : [...prev.genres, genre],
                          }));
                        }}
                      >
                        {genre}
                      </Button>
                    );
                  })}
                </div>
              </div>

            </div>
          </div>
          <DrawerFooter className="shrink-0">
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={clearFilters}>
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
              <Button className="flex-1" onClick={applyFilters}>
                <Check className="h-4 w-4 mr-1" />
                Apply
              </Button>
            </div>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
