'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { SearchBar } from '@/components/media/search-bar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Skeleton } from '@/components/ui/skeleton';
import { DEFAULT_DISCOVER_FILTERS, type DiscoverFiltersState, useUIStore } from '@/lib/store';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import type {
  DiscoverDetail,
  DiscoverFiltersResponse,
  DiscoverItem,
  DiscoverSection,
} from '@/types';
import {
  Filter,
  Flame,
  Heart,
  Loader2,
  Search,
  Star,
  Tv,
  Film,
  Compass,
  ChevronRight,
  Sparkles,
} from 'lucide-react';

const SECTION_TO_BROWSE: Record<string, { sort: string; contentType: 'all' | 'movie' | 'show' | 'anime' }> = {
  trending: { sort: 'trending', contentType: 'all' },
  popular_movies: { sort: 'popular', contentType: 'movie' },
  popular_series: { sort: 'popular', contentType: 'show' },
  popular_anime: { sort: 'popular', contentType: 'anime' },
  upcoming_movies: { sort: 'upcoming', contentType: 'movie' },
  upcoming_series: { sort: 'upcoming', contentType: 'show' },
};

const SORT_OPTIONS = [
  { value: 'trending', label: 'Trending', icon: Flame },
  { value: 'highlyRated', label: 'Highly Rated', icon: Star },
  { value: 'mostLoved', label: 'Most Loved', icon: Heart },
  { value: 'popular', label: 'Popular', icon: Sparkles },
  { value: 'upcoming', label: 'Upcoming', icon: ChevronRight },
] as const;

interface RateLimitInfo {
  message: string;
  retryAfterSeconds: number | null;
  retryAt: string | null;
}

function formatYear(value: string | null) {
  if (!value) return 'Unknown';
  return value.slice(0, 4);
}

function cardTypeBadge(type: 'movie' | 'tv') {
  if (type === 'movie') return <Badge className="bg-blue-600/80 text-white text-[10px]">MOVIE</Badge>;
  return <Badge className="bg-violet-600/80 text-white text-[10px]">SERIES</Badge>;
}

function parsePositiveInt(value: string) {
  const normalized = value.trim();
  if (!normalized) return undefined;
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function parsePositiveFloat(value: string) {
  const normalized = value.trim();
  if (!normalized) return undefined;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function normalizeFilterValues(filters: DiscoverFiltersState): DiscoverFiltersState {
  return {
    ...filters,
    yearFrom: parsePositiveInt(filters.yearFrom)?.toString() || '',
    yearTo: parsePositiveInt(filters.yearTo)?.toString() || '',
    runtimeMin: parsePositiveInt(filters.runtimeMin)?.toString() || '',
    runtimeMax: parsePositiveInt(filters.runtimeMax)?.toString() || '',
    ratingMin: parsePositiveFloat(filters.ratingMin)?.toString() || '',
    ratingMax: parsePositiveFloat(filters.ratingMax)?.toString() || '',
    voteCountMin: parsePositiveInt(filters.voteCountMin)?.toString() || '',
    language: filters.language.trim().toLowerCase(),
    region: (filters.region || DEFAULT_DISCOVER_FILTERS.region).trim().toUpperCase().slice(0, 2),
  };
}

function isDefaultFilters(filters: ReturnType<typeof useUIStore.getState>['discoverFilters']) {
  const hasSameNumberSet = (a: number[], b: number[]) => {
    if (a.length !== b.length) return false;
    const uniqueA = new Set(a);
    const uniqueB = new Set(b);
    if (uniqueA.size !== uniqueB.size) return false;
    for (const value of uniqueA) {
      if (!uniqueB.has(value)) return false;
    }
    return true;
  };

  return filters.genres.length === DEFAULT_DISCOVER_FILTERS.genres.length
    && hasSameNumberSet(filters.genres, DEFAULT_DISCOVER_FILTERS.genres)
    && filters.yearFrom === DEFAULT_DISCOVER_FILTERS.yearFrom
    && filters.yearTo === DEFAULT_DISCOVER_FILTERS.yearTo
    && filters.runtimeMin === DEFAULT_DISCOVER_FILTERS.runtimeMin
    && filters.runtimeMax === DEFAULT_DISCOVER_FILTERS.runtimeMax
    && filters.language === DEFAULT_DISCOVER_FILTERS.language
    && (!filters.region || filters.region === DEFAULT_DISCOVER_FILTERS.region)
    && filters.ratingMin === DEFAULT_DISCOVER_FILTERS.ratingMin
    && filters.ratingMax === DEFAULT_DISCOVER_FILTERS.ratingMax
    && filters.voteCountMin === DEFAULT_DISCOVER_FILTERS.voteCountMin
    && hasSameNumberSet(filters.providers, DEFAULT_DISCOVER_FILTERS.providers)
    && hasSameNumberSet(filters.networks, DEFAULT_DISCOVER_FILTERS.networks)
    && filters.releaseState === DEFAULT_DISCOVER_FILTERS.releaseState;
}

function formatWait(seconds: number) {
  const clamped = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function countActiveAdvancedFilters(filters: DiscoverFiltersState): number {
  let count = 0;
  if (filters.genres.length > 0) count += 1;
  if (filters.yearFrom || filters.yearTo) count += 1;
  if (filters.runtimeMin || filters.runtimeMax) count += 1;
  if (filters.ratingMin || filters.ratingMax) count += 1;
  if (filters.voteCountMin) count += 1;
  if (filters.language) count += 1;
  if (filters.region && filters.region !== DEFAULT_DISCOVER_FILTERS.region) count += 1;
  if (filters.providers.length > 0) count += 1;
  if (filters.networks.length > 0) count += 1;
  if (filters.releaseState) count += 1;
  return count;
}

function MediaPoster({
  item,
  onClick,
  variant = 'rail',
}: {
  item: DiscoverItem;
  onClick: (item: DiscoverItem) => void;
  variant?: 'rail' | 'grid';
}) {
  const isGrid = variant === 'grid';
  return (
    <button
      onClick={() => onClick(item)}
      className={isGrid
        ? 'group relative w-full min-w-0 text-left'
        : 'group relative min-w-[110px] w-[110px] sm:min-w-[140px] sm:w-[140px] text-left'}
    >
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-muted/60 border border-border/40">
        {item.posterPath ? (
          <Image
            src={toCachedImageSrc(item.posterPath, 'tmdb') || item.posterPath}
            alt={item.title}
            fill
            sizes={isGrid ? '(max-width: 640px) 33vw, (max-width: 1200px) 18vw, 170px' : '(max-width: 640px) 35vw, 140px'}
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            unoptimized={isProtectedApiImageSrc(toCachedImageSrc(item.posterPath, 'tmdb') || item.posterPath)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            {item.mediaType === 'movie' ? <Film className="h-7 w-7" /> : <Tv className="h-7 w-7" />}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
        <div className="absolute top-1.5 left-1.5">{cardTypeBadge(item.mediaType)}</div>
        {item.library?.exists && (
          <div className="absolute top-1.5 right-1.5">
            <Badge className="bg-green-600/90 text-[10px] text-white">Added</Badge>
          </div>
        )}
        <div className="absolute bottom-0 left-0 right-0 p-2">
          <p className="text-xs text-white font-medium line-clamp-2 leading-tight">{item.title}</p>
          <div className="mt-1 flex items-center justify-between text-[10px] text-white/80">
            <span>{item.year ?? '----'}</span>
            <span className="inline-flex items-center gap-1">
              <Star className="h-2.5 w-2.5 fill-yellow-400 text-yellow-400" />
              {item.rating.toFixed(1)}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

function SectionRow({
  section,
  onOpenItem,
  onSeeAll,
  onPickGenre,
  onPickProvider,
}: {
  section: DiscoverSection;
  onOpenItem: (item: DiscoverItem) => void;
  onSeeAll: (section: DiscoverSection) => void;
  onPickGenre: (genreId: number, type: 'movie' | 'show') => void;
  onPickProvider: (providerId: number, type: 'movie' | 'show') => void;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between px-0.5">
        <h2 className="text-base font-semibold">{section.title}</h2>
        {section.type === 'media' && (
          <button
            onClick={() => onSeeAll(section)}
            className="text-xs text-primary font-medium inline-flex items-center gap-1"
          >
            See all
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {section.type === 'media' && (
        <div className="flex gap-2.5 overflow-x-auto pb-1 snap-x snap-mandatory scrollbar-hide">
          {(section.items as DiscoverItem[]).map((item) => (
            <div key={`${item.mediaType}-${item.tmdbId}`} className="snap-start">
              <MediaPoster item={item} onClick={onOpenItem} />
            </div>
          ))}
        </div>
      )}

      {section.type === 'genre' && (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {(section.items as Array<{ id: number; name: string; type: 'movie' | 'tv' }>).map((genre) => (
            <button
              key={`${genre.type}-${genre.id}`}
              onClick={() => onPickGenre(genre.id, genre.type === 'movie' ? 'movie' : 'show')}
              className="px-4 py-3 rounded-xl border border-border/50 bg-accent/40 min-w-[150px] text-left"
            >
              <p className="text-sm font-semibold truncate">{genre.name}</p>
            </button>
          ))}
        </div>
      )}

      {section.type === 'provider' && (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {(section.items as Array<{ id: number; name: string; logoPath: string | null; type: 'movie' | 'tv' }>).map((provider) => (
            <button
              key={`${provider.type}-${provider.id}`}
              onClick={() => onPickProvider(provider.id, provider.type === 'movie' ? 'movie' : 'show')}
              className="min-w-[160px] rounded-xl border border-border/50 bg-accent/40 p-3 flex items-center gap-3"
            >
              <div className="relative h-8 w-8 rounded bg-background/70 overflow-hidden shrink-0">
                {provider.logoPath ? (
                  <Image
                    src={toCachedImageSrc(`https://image.tmdb.org/t/p/w185${provider.logoPath}`, 'tmdb') || `https://image.tmdb.org/t/p/w185${provider.logoPath}`}
                    alt={provider.name}
                    fill
                    sizes="32px"
                    className="object-contain"
                    unoptimized={isProtectedApiImageSrc(toCachedImageSrc(`https://image.tmdb.org/t/p/w185${provider.logoPath}`, 'tmdb') || `https://image.tmdb.org/t/p/w185${provider.logoPath}`)}
                  />
                ) : null}
              </div>
              <p className="text-sm font-semibold text-left truncate">{provider.name}</p>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export default function DiscoverPage() {
  const {
    discoverContentType,
    setDiscoverContentType,
    discoverSort,
    setDiscoverSort,
    discoverSortDirection,
    setDiscoverSortDirection,
    discoverFilters,
    setDiscoverFilters,
  } = useUIStore();

  const [query, setQuery] = useState('');
  const [sections, setSections] = useState<DiscoverSection[]>([]);
  const [items, setItems] = useState<DiscoverItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingSections, setLoadingSections] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [manualBrowseMode, setManualBrowseMode] = useState(false);
  const [filtersMeta, setFiltersMeta] = useState<DiscoverFiltersResponse | null>(null);
  const [draftFilters, setDraftFilters] = useState<DiscoverFiltersState>(discoverFilters);
  const [draftSort, setDraftSort] = useState(discoverSort);
  const [draftSortDirection, setDraftSortDirection] = useState(discoverSortDirection);
  const [activeSectionKey, setActiveSectionKey] = useState<string | null>(null);
  const [rateLimitInfo, setRateLimitInfo] = useState<RateLimitInfo | null>(null);
  const [rateLimitCountdown, setRateLimitCountdown] = useState<number | null>(null);
  const gridFetchControllerRef = useRef<AbortController | null>(null);
  const loadMoreControllerRef = useRef<AbortController | null>(null);

  const [selectedItem, setSelectedItem] = useState<{ id: number; mediaType: 'movie' | 'tv' } | null>(null);
  const [itemDetail, setItemDetail] = useState<DiscoverDetail | null>(null);
  const [itemLoading, setItemLoading] = useState(false);

  const applyRateLimit = useCallback((payload: unknown) => {
    const data = payload as {
      error?: string;
      code?: string;
      retryAfterSeconds?: number | null;
      retryAt?: string | null;
    } | null;

    setRateLimitInfo({
      message: data?.error || 'TMDB rate limit reached',
      retryAfterSeconds: Number.isFinite(data?.retryAfterSeconds as number)
        ? Math.max(1, Number(data?.retryAfterSeconds))
        : null,
      retryAt: data?.retryAt || null,
    });
  }, []);

  const hasAdvancedFilters = useMemo(() => !isDefaultFilters(discoverFilters), [discoverFilters]);
  const activeAdvancedFilterCount = useMemo(
    () => countActiveAdvancedFilters(discoverFilters),
    [discoverFilters]
  );

  const gridClassName = useMemo(
    () => 'grid grid-cols-[repeat(auto-fill,minmax(122px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(138px,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(154px,1fr))] xl:grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2.5 sm:gap-3.5 md:gap-4',
    []
  );

  const gridMode = useMemo(() => {
    return Boolean(
      manualBrowseMode ||
      query.trim()
      || hasAdvancedFilters
      || activeSectionKey
      || discoverSort !== 'trending'
      || discoverContentType !== 'all'
    );
  }, [manualBrowseMode, query, hasAdvancedFilters, activeSectionKey, discoverSort, discoverContentType]);

  const visibleSections = useMemo(() => {
    if (discoverContentType === 'all') return sections;

    return sections.filter((section) => {
      if (!section.mediaType || section.mediaType === 'all') {
        return section.key === 'providers' || discoverContentType === 'anime';
      }

      if (discoverContentType === 'movie') return section.mediaType === 'movie';
      if (discoverContentType === 'show') return section.mediaType === 'tv';
      if (discoverContentType === 'anime') return section.key === 'popular_anime';
      return true;
    });
  }, [sections, discoverContentType]);

  const fetchSections = useCallback(async () => {
    setLoadingSections(true);
    try {
      const res = await fetch('/api/discover?mode=sections');
      const data = await res.json();
      if (res.status === 429 || data?.code === 'TMDB_RATE_LIMIT') {
        applyRateLimit(data);
        return;
      }
      if (res.ok) {
        setRateLimitInfo(null);
        setSections(data.sections || []);
      }
    } finally {
      setLoadingSections(false);
    }
  }, [applyRateLimit]);

  const fetchFiltersMeta = useCallback(async () => {
    try {
      const res = await fetch('/api/discover/filters');
      const data = await res.json();
      if (res.status === 429 || data?.code === 'TMDB_RATE_LIMIT') {
        applyRateLimit(data);
        return;
      }
      if (!res.ok) return;
      setRateLimitInfo(null);
      setFiltersMeta(data);
    } catch {
      // no-op
    }
  }, [applyRateLimit]);

  const buildQueryString = useCallback((pageValue: number) => {
    const params = new URLSearchParams();
    const mode = query.trim() ? 'search' : 'browse';
    params.set('mode', mode);
    params.set('page', String(pageValue));
    params.set('contentType', discoverContentType);
    params.set('sortBy', discoverSort);
    params.set('sortOrder', discoverSortDirection);
    if (query.trim()) params.set('q', query.trim());
    if (activeSectionKey) params.set('section', activeSectionKey);

    if (discoverFilters.genres.length) params.set('genres', discoverFilters.genres.join(','));
    if (discoverFilters.yearFrom) params.set('yearFrom', discoverFilters.yearFrom);
    if (discoverFilters.yearTo) params.set('yearTo', discoverFilters.yearTo);
    if (discoverFilters.runtimeMin) params.set('runtimeMin', discoverFilters.runtimeMin);
    if (discoverFilters.runtimeMax) params.set('runtimeMax', discoverFilters.runtimeMax);
    if (discoverFilters.language) params.set('language', discoverFilters.language);
    if (discoverFilters.region) params.set('region', discoverFilters.region);
    if (discoverFilters.ratingMin) params.set('ratingMin', discoverFilters.ratingMin);
    if (discoverFilters.ratingMax) params.set('ratingMax', discoverFilters.ratingMax);
    if (discoverFilters.voteCountMin) params.set('voteCountMin', discoverFilters.voteCountMin);
    if (discoverFilters.providers.length) params.set('providers', discoverFilters.providers.join(','));
    if (discoverFilters.networks.length) params.set('networks', discoverFilters.networks.join(','));
    if (discoverFilters.releaseState) params.set('releaseState', discoverFilters.releaseState);

    return params.toString();
  }, [
    query,
    discoverContentType,
    discoverSort,
    discoverSortDirection,
    discoverFilters,
    activeSectionKey,
  ]);

  const fetchGridItems = useCallback(async (pageValue: number, append = false, signal?: AbortSignal) => {
    if (append) setLoadingMore(true);
    else setLoadingItems(true);

    let aborted = false;

    try {
      const res = await fetch(`/api/discover?${buildQueryString(pageValue)}`, { signal });
      if (signal?.aborted) {
        aborted = true;
        return;
      }
      const data = await res.json();
      if (signal?.aborted) {
        aborted = true;
        return;
      }
      if (res.status === 429 || data?.code === 'TMDB_RATE_LIMIT') {
        if (signal?.aborted) {
          aborted = true;
          return;
        }
        applyRateLimit(data);
        return;
      }
      if (!res.ok) return;
      if (signal?.aborted) {
        aborted = true;
        return;
      }

      setRateLimitInfo(null);
      const nextItems = data.items || [];
      setItems((prev) => append ? [...prev, ...nextItems] : nextItems);
      setPage(data.page || 1);
      setTotalPages(data.totalPages || 1);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        aborted = true;
      }
    } finally {
      if (!aborted) {
        setLoadingItems(false);
        setLoadingMore(false);
      }
    }
  }, [buildQueryString, applyRateLimit]);

  useEffect(() => {
    fetchSections();
    fetchFiltersMeta();
  }, [fetchSections, fetchFiltersMeta]);

  useEffect(() => {
    if (!gridMode) return;
    const controller = new AbortController();
    gridFetchControllerRef.current?.abort();
    gridFetchControllerRef.current = controller;
    void fetchGridItems(1, false, controller.signal);
    return () => {
      controller.abort();
      if (gridFetchControllerRef.current === controller) {
        gridFetchControllerRef.current = null;
      }
    };
  }, [gridMode, fetchGridItems]);

  useEffect(() => {
    loadMoreControllerRef.current?.abort();
    loadMoreControllerRef.current = null;
  }, [buildQueryString]);

  useEffect(() => {
    return () => {
      gridFetchControllerRef.current?.abort();
      loadMoreControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!selectedItem) {
      setItemDetail(null);
      return;
    }

    let cancelled = false;
    setItemLoading(true);
    fetch(`/api/discover/item?mediaType=${selectedItem.mediaType}&id=${selectedItem.id}`)
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (res.status === 429 || data?.code === 'TMDB_RATE_LIMIT') {
          applyRateLimit(data);
          return null;
        }
        if (res.ok) {
          setRateLimitInfo(null);
          return data;
        }
        return null;
      })
      .then((data) => {
        if (!cancelled) setItemDetail(data);
      })
      .finally(() => {
        if (!cancelled) setItemLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedItem, applyRateLimit]);

  useEffect(() => {
    if (!rateLimitInfo?.retryAfterSeconds) {
      setRateLimitCountdown(null);
      return;
    }

    setRateLimitCountdown(rateLimitInfo.retryAfterSeconds);
    const timer = setInterval(() => {
      setRateLimitCountdown((current) => {
        if (current == null) return null;
        return current <= 0 ? 0 : current - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [rateLimitInfo?.retryAfterSeconds]);

  useEffect(() => {
    if (!filtersOpen) return;
    setDraftFilters(discoverFilters);
    setDraftSort(discoverSort);
    setDraftSortDirection(discoverSortDirection);
  }, [filtersOpen, discoverFilters, discoverSort, discoverSortDirection]);

  useEffect(() => {
    if (query.trim()) {
      setActiveSectionKey(null);
      setManualBrowseMode(true);
    }
  }, [query]);

  const handleOpenItem = useCallback((item: DiscoverItem) => {
    setSelectedItem({ id: item.tmdbId, mediaType: item.mediaType });
  }, []);

  const handleOpenFilters = useCallback(() => {
    setDraftFilters(discoverFilters);
    setDraftSort(discoverSort);
    setDraftSortDirection(discoverSortDirection);
    setFiltersOpen(true);
  }, [discoverFilters, discoverSort, discoverSortDirection]);

  const handleSelectContentType = useCallback((type: 'all' | 'movie' | 'show' | 'anime') => {
    if (discoverContentType === type && gridMode) {
      const controller = new AbortController();
      gridFetchControllerRef.current?.abort();
      gridFetchControllerRef.current = controller;
      void fetchGridItems(1, false, controller.signal);
      return;
    }
    setDiscoverContentType(type);
    setActiveSectionKey(null);
    setManualBrowseMode(true);
  }, [discoverContentType, gridMode, fetchGridItems, setDiscoverContentType]);

  const handleSelectSort = useCallback((sort: string) => {
    if (discoverSort === sort && gridMode) {
      const controller = new AbortController();
      gridFetchControllerRef.current?.abort();
      gridFetchControllerRef.current = controller;
      void fetchGridItems(1, false, controller.signal);
      return;
    }
    setDiscoverSort(sort);
    setActiveSectionKey(null);
    setManualBrowseMode(true);
  }, [discoverSort, gridMode, fetchGridItems, setDiscoverSort]);

  const handleLoadMore = useCallback(() => {
    if (loadingMore || page >= totalPages) return;
    const controller = new AbortController();
    loadMoreControllerRef.current?.abort();
    loadMoreControllerRef.current = controller;
    void fetchGridItems(page + 1, true, controller.signal);
  }, [fetchGridItems, loadingMore, page, totalPages]);

  const goToDiscoverHome = useCallback(() => {
    setDiscoverFilters({ ...DEFAULT_DISCOVER_FILTERS });
    setDiscoverSort('trending');
    setDiscoverSortDirection('desc');
    setDiscoverContentType('all');
    setActiveSectionKey(null);
    setQuery('');
    setManualBrowseMode(false);
  }, [setDiscoverFilters, setDiscoverSort, setDiscoverSortDirection, setDiscoverContentType]);

  const handleSeeAll = useCallback((section: DiscoverSection) => {
    setActiveSectionKey(section.key);
    setManualBrowseMode(true);
    const mapped = SECTION_TO_BROWSE[section.key];
    if (mapped) {
      setDiscoverSort(mapped.sort);
      setDiscoverContentType(mapped.contentType);
      if (mapped.sort === 'upcoming') setDiscoverSortDirection('asc');
      else setDiscoverSortDirection('desc');
    }
  }, [setDiscoverSort, setDiscoverContentType, setDiscoverSortDirection]);

  const pickGenre = useCallback((genreId: number, type: 'movie' | 'show') => {
    setDiscoverFilters({
      ...discoverFilters,
      genres: discoverFilters.genres.includes(genreId)
        ? discoverFilters.genres
        : [...discoverFilters.genres, genreId],
    });
    setDiscoverContentType(type);
    setActiveSectionKey(null);
    setManualBrowseMode(true);
  }, [discoverFilters, setDiscoverFilters, setDiscoverContentType]);

  const pickProvider = useCallback((providerId: number, type: 'movie' | 'show') => {
    setDiscoverFilters({
      ...discoverFilters,
      providers: discoverFilters.providers.includes(providerId)
        ? discoverFilters.providers
        : [...discoverFilters.providers, providerId],
    });
    setDiscoverContentType(type);
    setActiveSectionKey(null);
    setManualBrowseMode(true);
  }, [discoverFilters, setDiscoverFilters, setDiscoverContentType]);

  const resetFilters = useCallback(() => {
    goToDiscoverHome();
  }, [goToDiscoverHome]);

  const genreChoices = useMemo(() => {
    if (!filtersMeta) return [];
    if (discoverContentType === 'movie') return filtersMeta.genres.filter((genre) => genre.type === 'movie');
    if (discoverContentType === 'show') return filtersMeta.genres.filter((genre) => genre.type === 'tv');
    return filtersMeta.genres;
  }, [filtersMeta, discoverContentType]);

  const providerChoices = useMemo(() => {
    if (!filtersMeta) return [];
    if (discoverContentType === 'movie') return filtersMeta.providers.filter((provider) => provider.type === 'movie');
    if (discoverContentType === 'show') return filtersMeta.providers.filter((provider) => provider.type === 'tv');
    return filtersMeta.providers;
  }, [filtersMeta, discoverContentType]);

  const detailAddHref = useMemo(() => {
    if (!itemDetail) return null;
    if (itemDetail.addTarget.exists && itemDetail.addTarget.id) {
      return itemDetail.addTarget.service === 'radarr'
        ? `/movies/${itemDetail.addTarget.id}`
        : `/series/${itemDetail.addTarget.id}`;
    }

    if (itemDetail.mediaType === 'movie') {
      const params = new URLSearchParams();
      params.set('term', itemDetail.title);
      params.set('tmdbId', String(itemDetail.tmdbId));
      return `/movies/add?${params.toString()}`;
    }

    const params = new URLSearchParams();
    params.set('term', itemDetail.title);
    params.set('tmdbId', String(itemDetail.tmdbId));
    if (itemDetail.tvdbId) params.set('tvdbId', String(itemDetail.tvdbId));
    params.set('seriesType', itemDetail.isAnime ? 'anime' : 'standard');
    return `/series/add?${params.toString()}`;
  }, [itemDetail]);

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-30 pt-1 pb-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <SearchBar
              value={query}
              onChange={setQuery}
              placeholder="Search movies, shows, anime"
            />
          </div>
          <button
            onClick={handleOpenFilters}
            className="relative h-10 w-10 rounded-lg border border-border/60 flex items-center justify-center"
            aria-label="Advanced filters"
          >
            <Filter className="h-4 w-4" />
            {activeAdvancedFilterCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold flex items-center justify-center">
                {activeAdvancedFilterCount > 9 ? '9+' : activeAdvancedFilterCount}
              </span>
            )}
          </button>
        </div>

        <div className="mt-2 space-y-2">
          {/* <p className="text-[11px] font-medium text-muted-foreground">Type</p> */}
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
            {[
              { value: 'all', label: 'All', icon: Compass },
              { value: 'movie', label: 'Movies', icon: Film },
              { value: 'show', label: 'Shows', icon: Tv },
              { value: 'anime', label: 'Anime', icon: Sparkles },
            ].map((option) => {
              const Icon = option.icon;
              const active = discoverContentType === option.value;
              return (
                <button
                  key={option.value}
                  onClick={() => handleSelectContentType(option.value as 'all' | 'movie' | 'show' | 'anime')}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap inline-flex items-center gap-1.5 ${
                    active ? 'bg-primary text-primary-foreground' : 'bg-accent/50 text-muted-foreground'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {option.label}
                </button>
              );
            })}
          </div>
          {/* <p className="text-[11px] font-medium text-muted-foreground">Sort</p> */}
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
            {SORT_OPTIONS.map((option) => {
              const active = discoverSort === option.value;
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  onClick={() => handleSelectSort(option.value)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap inline-flex items-center gap-1.5 ${
                    active ? 'bg-primary/20 text-primary border border-primary/40' : 'bg-accent/40 text-muted-foreground'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        {rateLimitInfo && (
          <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">TMDB rate limit reached</p>
            <p className="text-xs text-amber-800/90 dark:text-amber-200/90">
              {rateLimitCountdown != null
                ? `Please wait ${formatWait(rateLimitCountdown)} before retrying.`
                : rateLimitInfo.retryAt
                  ? `Please retry around ${new Date(rateLimitInfo.retryAt).toLocaleTimeString()}.`
                  : `${rateLimitInfo.message}. Please wait and try again.`}
            </p>
          </div>
        )}
      </div>

      {!gridMode && (
        <div className="space-y-5">
          {loadingSections ? (
            <div className="space-y-5">
              {[...Array(6)].map((_, idx) => (
                <div key={idx} className="space-y-2">
                  <Skeleton className="h-5 w-40" />
                  <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-hide">
                    {[...Array(8)].map((__, i) => (
                      <Skeleton key={i} className="h-[165px] w-[110px] sm:h-[210px] sm:w-[140px] rounded-xl shrink-0" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            visibleSections.map((section) => (
              <SectionRow
                key={section.key}
                section={section}
                onOpenItem={handleOpenItem}
                onSeeAll={handleSeeAll}
                onPickGenre={pickGenre}
                onPickProvider={pickProvider}
              />
            ))
          )}
        </div>
      )}

      {gridMode && (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm text-muted-foreground">Discover Results</p>
              <p className="text-xs text-muted-foreground">
                {activeSectionKey ? `Section: ${activeSectionKey.replaceAll('_', ' ')}` : 'Custom search and filters'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {activeSectionKey && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveSectionKey(null)}
                  className="h-8 px-2 text-xs"
                >
                  Clear section
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={goToDiscoverHome} className="h-8 px-2 text-xs">
                Back to Discover
              </Button>
            </div>
          </div>

          {loadingItems ? (
            <div className={gridClassName}>
              {[...Array(24)].map((_, idx) => (
                <Skeleton key={idx} className="w-full aspect-[2/3] rounded-xl" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-border/60 bg-card p-8 text-center space-y-2">
              <Search className="h-6 w-6 mx-auto text-muted-foreground" />
              <p className="font-semibold">No matches found</p>
              <p className="text-sm text-muted-foreground">Try adjusting filters or search query.</p>
              <Button variant="outline" onClick={resetFilters}>Reset filters</Button>
            </div>
          ) : (
            <>
              <div className={gridClassName}>
                {items.map((item) => (
                  <MediaPoster key={`${item.mediaType}-${item.tmdbId}`} item={item} onClick={handleOpenItem} variant="grid" />
                ))}
              </div>

              {page < totalPages && (
                <div className="flex justify-center pt-2">
                  <Button
                    variant="outline"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                  >
                    {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Load more'}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="right" className="w-[92vw] sm:max-w-md p-0">
          <SheetHeader>
            <SheetTitle>Advanced Filters</SheetTitle>
          </SheetHeader>

          <div className="px-4 pb-4 overflow-y-auto space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Sort</label>
              <div className="grid grid-cols-2 gap-2">
                {SORT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => {
                      setDraftSort(option.value);
                    }}
                    className={`px-3 py-2 rounded-lg border text-sm ${draftSort === option.value ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Sort Direction</label>
              <div className="grid grid-cols-2 gap-2">
                {['desc', 'asc'].map((dir) => (
                  <button
                    key={dir}
                    onClick={() => setDraftSortDirection(dir as 'asc' | 'desc')}
                    className={`px-3 py-2 rounded-lg border text-sm uppercase ${draftSortDirection === dir ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
                  >
                    {dir}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Year From</label>
                <Input
                  value={draftFilters.yearFrom}
                  onChange={(e) => setDraftFilters({ ...draftFilters, yearFrom: e.target.value })}
                  placeholder="1995"
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Year To</label>
                <Input
                  value={draftFilters.yearTo}
                  onChange={(e) => setDraftFilters({ ...draftFilters, yearTo: e.target.value })}
                  placeholder="2026"
                  inputMode="numeric"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Runtime Min</label>
                <Input
                  value={draftFilters.runtimeMin}
                  onChange={(e) => setDraftFilters({ ...draftFilters, runtimeMin: e.target.value })}
                  placeholder="45"
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Runtime Max</label>
                <Input
                  value={draftFilters.runtimeMax}
                  onChange={(e) => setDraftFilters({ ...draftFilters, runtimeMax: e.target.value })}
                  placeholder="180"
                  inputMode="numeric"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Rating Min</label>
                <Input
                  value={draftFilters.ratingMin}
                  onChange={(e) => setDraftFilters({ ...draftFilters, ratingMin: e.target.value })}
                  placeholder="7.5"
                  inputMode="decimal"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Rating Max</label>
                <Input
                  value={draftFilters.ratingMax}
                  onChange={(e) => setDraftFilters({ ...draftFilters, ratingMax: e.target.value })}
                  placeholder="10"
                  inputMode="decimal"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Vote Count Min</label>
              <Input
                value={draftFilters.voteCountMin}
                onChange={(e) => setDraftFilters({ ...draftFilters, voteCountMin: e.target.value })}
                placeholder="500"
                inputMode="numeric"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Language</label>
                <Input
                  value={draftFilters.language}
                  onChange={(e) => setDraftFilters({ ...draftFilters, language: e.target.value })}
                  placeholder="en"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Region</label>
                <Input
                  value={draftFilters.region}
                  onChange={(e) => setDraftFilters({ ...draftFilters, region: e.target.value })}
                  placeholder="US"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Release State</label>
              <div className="grid grid-cols-2 gap-2">
                {['', 'released', 'upcoming', 'airing', 'ended'].map((state) => (
                  <button
                    key={state || 'all'}
                    onClick={() => setDraftFilters({ ...draftFilters, releaseState: state as '' | 'released' | 'upcoming' | 'airing' | 'ended' })}
                    className={`px-3 py-2 rounded-lg border text-sm ${draftFilters.releaseState === state ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
                  >
                    {state || 'Any'}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Genres</label>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-border/50 p-2">
                <div className="flex flex-wrap gap-2">
                {genreChoices.slice(0, 28).map((genre) => {
                  const active = draftFilters.genres.includes(genre.id);
                  return (
                    <button
                      key={`${genre.type}-${genre.id}`}
                      onClick={() => {
                        const set = new Set(draftFilters.genres);
                        if (set.has(genre.id)) set.delete(genre.id);
                        else set.add(genre.id);
                        setDraftFilters({ ...draftFilters, genres: [...set] });
                      }}
                      className={`px-2.5 py-1 rounded-full text-xs border whitespace-normal text-left leading-tight ${active ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
                    >
                      {genre.name}
                    </button>
                  );
                })}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Providers</label>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-border/50 p-2">
                <div className="flex flex-wrap gap-2">
                {providerChoices.slice(0, 28).map((provider) => {
                  const active = draftFilters.providers.includes(provider.id);
                  return (
                    <button
                      key={`${provider.type}-${provider.id}`}
                      onClick={() => {
                        const set = new Set(draftFilters.providers);
                        if (set.has(provider.id)) set.delete(provider.id);
                        else set.add(provider.id);
                        setDraftFilters({ ...draftFilters, providers: [...set] });
                      }}
                      className={`px-2.5 py-1 rounded-full text-xs border whitespace-normal text-left leading-tight ${active ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
                    >
                      {provider.name}
                    </button>
                  );
                })}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Networks</label>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-border/50 p-2">
                <div className="flex flex-wrap gap-2">
                {(filtersMeta?.networks || []).slice(0, 24).map((network) => {
                  const active = draftFilters.networks.includes(network.id);
                  return (
                    <button
                      key={network.id}
                      onClick={() => {
                        const set = new Set(draftFilters.networks);
                        if (set.has(network.id)) set.delete(network.id);
                        else set.add(network.id);
                        setDraftFilters({ ...draftFilters, networks: [...set] });
                      }}
                      className={`px-2.5 py-1 rounded-full text-xs border whitespace-normal text-left leading-tight ${active ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}
                    >
                      {network.name}
                    </button>
                  );
                })}
                </div>
              </div>
            </div>
          </div>

          <SheetFooter className="border-t">
            <div className="grid grid-cols-2 gap-2 w-full">
              <Button
                variant="outline"
                onClick={() => {
                  setDraftFilters({ ...DEFAULT_DISCOVER_FILTERS });
                  setDraftSort('trending');
                  setDraftSortDirection('desc');
                }}
              >
                Reset
              </Button>
              <Button onClick={() => {
                const normalized = normalizeFilterValues(draftFilters);
                setDiscoverFilters(normalized);
                setDiscoverSort(draftSort);
                setDiscoverSortDirection(draftSortDirection);
                setActiveSectionKey(null);
                setManualBrowseMode(
                  Boolean(
                    query.trim()
                    || !isDefaultFilters(normalized)
                    || draftSort !== 'trending'
                    || discoverContentType !== 'all'
                  )
                );
                setFiltersOpen(false);
              }}>
                Apply
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Drawer open={!!selectedItem} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <DrawerContent className="max-h-[94vh]">
          <DrawerTitle className="sr-only">Discover detail</DrawerTitle>
          <DrawerDescription className="sr-only">Media details and add action</DrawerDescription>
          <div className="overflow-y-auto pb-6">
            {itemLoading || !itemDetail ? (
              <div className="p-4 space-y-3">
                <Skeleton className="h-52 w-full rounded-xl" />
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="relative h-52 w-full bg-muted">
                  {itemDetail.backdropPath ? (
                    <Image
                      src={toCachedImageSrc(itemDetail.backdropPath, 'tmdb') || itemDetail.backdropPath}
                      alt={itemDetail.title}
                      fill
                      sizes="100vw"
                      className="object-cover"
                      unoptimized={isProtectedApiImageSrc(toCachedImageSrc(itemDetail.backdropPath, 'tmdb') || itemDetail.backdropPath)}
                    />
                  ) : null}
                  <div className="absolute inset-0 bg-gradient-to-t from-background via-background/35 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-4">
                    <div className="flex items-center gap-2 text-xs text-white/90">
                      {cardTypeBadge(itemDetail.mediaType)}
                      {itemDetail.isAnime && <Badge className="bg-pink-600/90 text-[10px] text-white">ANIME</Badge>}
                    </div>
                    <h3 className="mt-2 text-lg font-semibold text-white line-clamp-2">{itemDetail.title}</h3>
                    <p className="text-xs text-white/80">
                      {formatYear(itemDetail.releaseDate)} • {itemDetail.runtime ? `${itemDetail.runtime} min` : 'Runtime N/A'} • {itemDetail.rating.toFixed(1)}
                    </p>
                  </div>
                </div>

                <div className="px-4 space-y-3">
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {itemDetail.overview || 'No overview available.'}
                  </p>

                  <div className="flex flex-wrap gap-1.5">
                    {(itemDetail.genreNames || []).map((genre) => (
                      <Badge key={genre} variant="outline" className="text-xs">{genre}</Badge>
                    ))}
                  </div>

                  {detailAddHref && (
                    <Button asChild className="w-full h-11">
                      <Link href={detailAddHref} onClick={() => setSelectedItem(null)}>
                        {itemDetail.addTarget.exists ? 'Open in Library' : (itemDetail.mediaType === 'movie' ? 'Add to Radarr' : 'Add to Sonarr')}
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
