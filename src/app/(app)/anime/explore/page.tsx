'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { SearchBar } from '@/components/media/search-bar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageSpinner } from '@/components/ui/page-spinner';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { DEFAULT_ANIME_FILTERS, type AnimeFiltersState, useUIStore } from '@/lib/store';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
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

export default function AnimePage() {
  const urlParams = useSearchParams();
  const animeSort = useUIStore((s) => s.animeSort);
  const setAnimeSort = useUIStore((s) => s.setAnimeSort);
  const animeFilters = useUIStore((s) => s.animeFilters);
  const setAnimeFilters = useUIStore((s) => s.setAnimeFilters);
  const hasHydrated = useUIStore((s) => s.hasHydrated);

  const [viewMode, setViewMode] = useState<'browse' | 'search'>('browse');
  const [items, setItems] = useState<AnimeItemWithLibrary[]>([]);
  const [pageInfo, setPageInfo] = useState<AniListPageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);

  const initRef = useRef(false);

  // Initialize from URL params exactly once
  useEffect(() => {
    if (!hasHydrated || initRef.current) return;
    initRef.current = true;

    const urlSort = urlParams.get('sort');
    const urlSeason = urlParams.get('season');
    const urlYear = urlParams.get('year');
    const urlYearMin = urlParams.get('yearMin');
    const urlYearMax = urlParams.get('yearMax');
    const urlStatus = urlParams.get('status');
    const urlFormat = urlParams.get('format');
    const urlGenres = urlParams.get('genres');

    let hasChanges = false;
    const newFilters = { ...animeFilters };

    if (urlSort) {
      setAnimeSort(urlSort);
      hasChanges = true;
    }

    if (urlSeason || urlYear || urlYearMin || urlYearMax || urlStatus || urlFormat || urlGenres) {
      if (urlSeason) newFilters.season = urlSeason;
      if (urlYear) newFilters.year = urlYear;
      if (urlYearMin) newFilters.yearMin = urlYearMin;
      if (urlYearMax) newFilters.yearMax = urlYearMax;
      if (urlStatus) newFilters.status = urlStatus;
      if (urlFormat) newFilters.formats = urlFormat.split(',') as AniListMediaFormat[];
      if (urlGenres) newFilters.genres = urlGenres.split(',');
      setAnimeFilters(newFilters);
      hasChanges = true;
    }

    if (hasChanges) {
      // The store updates will trigger a re-render. We can rely on the fetch effect below.
    }
  }, [hasHydrated, urlParams, setAnimeSort, setAnimeFilters, animeFilters]);

  const [draftFilters, setDraftFilters] = useState<AnimeFiltersState>(animeFilters);
  const [draftSort, setDraftSort] = useState(animeSort);

  // Sync draft state when store updates from URL
  useEffect(() => {
    setDraftFilters(animeFilters);
    setDraftSort(animeSort);
  }, [animeFilters, animeSort]);

  const abortRef = useRef<AbortController | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const activeFilterCount =
    animeFilters.genres.length
    + (animeFilters.year !== '' ? 1 : 0)
    + (animeFilters.yearMin !== '' || animeFilters.yearMax !== '' ? 1 : 0)
    + (animeFilters.season !== '' ? 1 : 0)
    + animeFilters.formats.length
    + (animeFilters.status !== '' ? 1 : 0);

  const hasFilters = activeFilterCount > 0;

  const fetchBrowse = useCallback(async (page = 1, append = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (page === 1) setLoading(true);
    else setLoadingMore(true);

    try {
      const params = new URLSearchParams({ mode: 'browse', page: String(page), sort: animeSort });

      if (animeFilters.genres.length) params.set('genres', animeFilters.genres.join(','));
      if (animeFilters.formats.length) params.set('format', animeFilters.formats.join(','));
      if (animeFilters.status) params.set('status', animeFilters.status);

      if (animeFilters.year) params.set('year', animeFilters.year);
      if (animeFilters.yearMin) params.set('yearMin', animeFilters.yearMin);
      if (animeFilters.yearMax) params.set('yearMax', animeFilters.yearMax);
      if (animeFilters.season) params.set('season', animeFilters.season);

      const res = await fetch(`/api/anime?${params}`, { signal: controller.signal });
      if (!res.ok) throw new Error('Failed to fetch');
      const data: ListResponse = await res.json();

      if (!controller.signal.aborted) {
        setItems((prev) => append ? [...prev, ...data.items] : data.items);
        setPageInfo(data.pageInfo);
        setViewMode('browse');
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      console.error(e);
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [animeSort, animeFilters]);

  const fetchSearch = useCallback(async (query: string, page = 1, append = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (page === 1) setLoading(true);
    else setLoadingMore(true);

    try {
      const params = new URLSearchParams({ mode: 'search', q: query, page: String(page) });
      const res = await fetch(`/api/anime?${params}`, { signal: controller.signal });
      if (!res.ok) throw new Error('Failed to fetch');
      const data: ListResponse = await res.json();

      if (!controller.signal.aborted) {
        setItems((prev) => append ? [...prev, ...data.items] : data.items);
        setPageInfo(data.pageInfo);
        setViewMode('search');
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      console.error(e);
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  // Initial load
  useEffect(() => {
    if (!hasHydrated) return;
    fetchBrowse(1);
  }, [hasHydrated, fetchBrowse]);

  // Search effect
  useEffect(() => {
    if (!hasHydrated) return;
    const trimmedQuery = searchQuery.trim();
    const timeoutId = window.setTimeout(() => {
      if (!trimmedQuery) {
        if (viewMode === 'search') fetchBrowse(1);
        return;
      }

      if (trimmedQuery.length < 3) return;

      fetchSearch(trimmedQuery);
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [searchQuery, hasHydrated, fetchSearch, fetchBrowse, viewMode]);

  // Infinite scroll
  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && pageInfo?.hasNextPage && !loadingMore && !loading) {
          const nextPage = (pageInfo.currentPage || 1) + 1;
          const trimmedQuery = searchQuery.trim();
          if (viewMode === 'search' && trimmedQuery.length >= 3) {
            fetchSearch(trimmedQuery, nextPage, true);
          } else if (viewMode === 'browse') {
            fetchBrowse(nextPage, true);
          }
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [viewMode, pageInfo, loadingMore, loading, searchQuery, fetchSearch, fetchBrowse]);

  const handleSortChange = (sort: string) => {
    setAnimeSort(sort);
    setSearchQuery('');
    setViewMode('browse');
  };

  // Re-fetch browse when sort or filters change
  useEffect(() => {
    if (!hasHydrated || viewMode === 'search') return;
    fetchBrowse(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animeSort, animeFilters]);

  const applyFilters = () => {
    setAnimeSort(draftSort);
    setAnimeFilters(draftFilters);
    setFilterOpen(false);
    setSearchQuery('');
    setViewMode('browse');
  };

  const clearFilters = () => {
    setAnimeSort('seasonal');
    setAnimeFilters(DEFAULT_ANIME_FILTERS);
    setDraftFilters(DEFAULT_ANIME_FILTERS);
    setDraftSort('seasonal');
    setViewMode('browse');
    setFilterOpen(false);
  };

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
      <div className="sticky z-30 -mx-2 px-2 pt-1 pb-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 space-y-1" style={{ top: 'var(--header-height, 0px)' }}>
        <SearchBar
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Search anime..."
        />

      {/* Sort pills + Filter button */}
      {viewMode !== 'search' && (
        <div className="py-2 flex gap-2 overflow-x-auto scrollbar-hide">
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

      {/* Content */}
      {loading ? (
        <PageSpinner />
      ) : (
        <div className="pt-2">
          {items.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">No results found</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
              {items.map((item) => (
                <AnimeCard key={item.id} item={item} grid />
              ))}
            </div>
          )}
          <div ref={sentinelRef} className="h-4" />
          {loadingMore && (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      )}

      {/* Filter Drawer */}
      <Drawer open={filterOpen} onOpenChange={setFilterOpen}>
        <DrawerContent className="max-h-[85vh]">
          <div className="overflow-y-auto px-4 pb-10">
            <DrawerHeader className="px-0 py-4">
              <DrawerTitle>Filters</DrawerTitle>
            </DrawerHeader>
            <div className="space-y-6">
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
                <input
                  type="number"
                  placeholder="Exact Year (e.g. 2024)"
                  value={draftFilters.year}
                  onChange={(e) => setDraftFilters((prev) => ({ ...prev, year: e.target.value, yearMin: '', yearMax: '' }))}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm mb-2"
                />
                <span className="text-xs text-muted-foreground">Or specify a range:</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    placeholder="Min Year"
                    value={draftFilters.yearMin}
                    onChange={(e) => setDraftFilters((prev) => ({ ...prev, yearMin: e.target.value, year: '' }))}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <input
                    type="number"
                    placeholder="Max Year"
                    value={draftFilters.yearMax}
                    onChange={(e) => setDraftFilters((prev) => ({ ...prev, yearMax: e.target.value, year: '' }))}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  />
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
                    const label = st === 'NOT_YET_RELEASED' ? 'Upcoming' : st.charAt(0) + st.slice(1).toLowerCase();
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
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function AnimeCard({ item, grid }: { item: AnimeItemWithLibrary; grid?: boolean }) {
  const imgSrc = item.coverImage
    ? toCachedImageSrc(item.coverImage, 'anilist') || item.coverImage
    : null;

  return (
    <Link
      href={`/anime/${item.id}`}
      className={`${grid ? '' : 'flex-shrink-0 w-[110px]'} group`}
    >
      <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-muted shadow-sm group-hover:shadow-md transition-shadow">
        {imgSrc ? (
          <Image
            src={imgSrc}
            alt={item.title}
            fill
            sizes={grid ? '(max-width: 640px) 33vw, (max-width: 768px) 25vw, 16vw' : '110px'}
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            unoptimized={isProtectedApiImageSrc(imgSrc)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs p-2 text-center">
            {item.title}
          </div>
        )}
        {/* Bottom gradient for readability */}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
        {item.averageScore != null && item.averageScore > 0 && (
          <Badge className="absolute top-1 right-1 text-[9px] bg-black/60 text-white gap-0.5">
            <Star className="h-2 w-2 fill-yellow-400 text-yellow-400" />
            {item.averageScore}%
          </Badge>
        )}
        {item.library?.exists && (
          <Badge className="absolute top-1 left-1 text-[9px] bg-green-600/80 text-white">
            <Check className="h-2 w-2" />
          </Badge>
        )}
        {item.format && (
          <Badge className="absolute bottom-1 left-1 text-[9px] bg-black/60 text-white">
            {item.format.replace(/_/g, ' ')}
          </Badge>
        )}
      </div>
      <p className="mt-1 text-xs font-medium leading-tight line-clamp-2">{item.title}</p>
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {item.year && <span>{item.year}</span>}
        {item.episodes != null && (
          <>
            {item.year && <span>·</span>}
            <span>{item.episodes} eps</span>
          </>
        )}
      </div>
    </Link>
  );
}
