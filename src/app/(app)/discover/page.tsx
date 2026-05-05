'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet';
import { PageSpinner } from '@/components/ui/page-spinner';
import { DEFAULT_DISCOVER_FILTERS, type DiscoverFiltersState, useUIStore } from '@/lib/store';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import type {
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
  X,
  User,
  Check,
  ArrowUpRight,
} from 'lucide-react';

const SECTION_TO_BROWSE: Record<string, { sort: string; contentType: 'all' | 'movie' | 'show' }> = {
  trending: { sort: 'trending', contentType: 'all' },
  popular_movies: { sort: 'popular', contentType: 'movie' },
  popular_series: { sort: 'popular', contentType: 'show' },
  upcoming_movies: { sort: 'upcoming', contentType: 'movie' },
  upcoming_series: { sort: 'upcoming', contentType: 'show' },
  now_playing: { sort: 'popular', contentType: 'movie' },
  airing_today: { sort: 'popular', contentType: 'show' },
  top_rated_movies: { sort: 'highlyRated', contentType: 'movie' },
  top_rated_tv: { sort: 'highlyRated', contentType: 'show' },
};

const SORT_OPTIONS = [
  { value: 'trending', label: 'Trending', icon: Flame },
  { value: 'highlyRated', label: 'Highly Rated', icon: Star },
  { value: 'mostLoved', label: 'Most Loved', icon: Heart },
  { value: 'popular', label: 'Popular', icon: Sparkles },
  { value: 'upcoming', label: 'Upcoming', icon: ChevronRight },
] as const;

const TYPE_OPTIONS = [
  { value: 'all', label: 'All', code: 'M+TV', icon: Compass },
  { value: 'movie', label: 'Movies', code: 'M', icon: Film },
  { value: 'show', label: 'Shows', code: 'TV', icon: Tv },
] as const;

interface RateLimitInfo {
  message: string;
  retryAfterSeconds: number | null;
  retryAt: string | null;
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
  const hasSameNumberSet = (a: number[] | undefined, b: number[] | undefined) => {
    const aa = a ?? [];
    const bb = b ?? [];
    if (aa.length !== bb.length) return false;
    const uniqueA = new Set(aa);
    const uniqueB = new Set(bb);
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
    && hasSameNumberSet(filters.companies, DEFAULT_DISCOVER_FILTERS.companies)
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
  if (filters.companies.length > 0) count += 1;
  if (filters.releaseState) count += 1;
  return count;
}

function reelNumber(index: number) {
  return String(index + 1).padStart(2, '0');
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
  const posterSrc = item.posterPath
    ? (toCachedImageSrc(item.posterPath, 'tmdb') || item.posterPath)
    : null;
  return (
    <button
      onClick={() => onClick(item)}
      className={`group relative block text-left press-feedback ${
        isGrid
          ? 'w-full min-w-0'
          : 'min-w-[124px] w-[124px] sm:min-w-[148px] sm:w-[148px] lg:min-w-[172px] lg:w-[172px]'
      }`}
    >
      <div
        className="relative aspect-[2/3] overflow-hidden bg-muted/40 transition-all duration-500 ease-out group-hover:shadow-[0_18px_38px_-18px_var(--amber-glow)]"
        style={{ borderRadius: 'calc(var(--radius) - 1px)' }}
      >
        {/* Hairline frame */}
        <div
          aria-hidden
          className="absolute inset-0 z-20 pointer-events-none transition-colors duration-300 group-hover:border-[color:var(--amber-soft)]"
          style={{ borderRadius: 'inherit', border: '1px solid var(--hairline)' }}
        />

        {posterSrc ? (
          <Image
            src={posterSrc}
            alt={item.title}
            fill
            sizes={isGrid ? '(max-width: 640px) 33vw, (max-width: 1024px) 22vw, (max-width: 1536px) 16vw, 180px' : '(max-width: 640px) 35vw, 172px'}
            className="object-cover transition-transform duration-[700ms] ease-out group-hover:scale-[1.06]"
            unoptimized={isProtectedApiImageSrc(posterSrc)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/70">
            {item.mediaType === 'movie' ? <Film className="h-7 w-7" /> : <Tv className="h-7 w-7" />}
          </div>
        )}

        {/* Cinematic gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-[color:var(--ink-deep)]/95 via-[color:var(--ink-deep)]/35 to-transparent" />

        {/* Amber sheen on hover */}
        <div className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-gradient-to-tr from-[color:var(--amber-soft)] via-transparent to-transparent" />

        {/* Top-left: media type tracked-caps tag */}
        <div className="absolute top-2 left-2 z-10">
          <span
            className="tracked-caps text-[8.5px] px-1.5 py-0.5 bg-black/60 text-white/90 backdrop-blur-sm border border-white/10"
            style={{ borderRadius: '3px', letterSpacing: '0.22em' }}
          >
            {item.mediaType === 'movie' ? 'Film' : 'Series'}
          </span>
        </div>

        {/* Top-right: in-library badge */}
        {item.library?.exists && (
          <div
            className="absolute top-2 right-2 z-10 flex items-center justify-center h-5 w-5 backdrop-blur-sm"
            style={{
              borderRadius: '3px',
              background: 'oklch(0.72 0.13 162 / 0.92)',
              boxShadow: '0 0 0 1px oklch(0.72 0.13 162 / 0.6), 0 4px 10px -3px oklch(0.72 0.13 162 / 0.5)',
            }}
            title="In your library"
          >
            <Check className="h-3 w-3 text-[color:var(--ink-deep)]" strokeWidth={3} />
          </div>
        )}

        {/* Bottom: title + meta */}
        <div className="absolute bottom-0 left-0 right-0 z-10 p-2.5 space-y-1">
          <p className="font-display text-[13px] sm:text-[14px] leading-tight text-white line-clamp-2" style={{ letterSpacing: '-0.015em' }}>
            {item.title}
          </p>
          <div className="flex items-center justify-between text-[10px] text-white/75">
            <span className="font-mono tabular tracked-mid text-[9px]">{item.year ?? '----'}</span>
            <span className="inline-flex items-center gap-1 font-mono tabular">
              <Star className="h-2.5 w-2.5 fill-[color:var(--amber)] text-[color:var(--amber)]" />
              {item.rating.toFixed(1)}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

function ReelHeader({
  index,
  title,
  eyebrow,
  onSeeAll,
}: {
  index: number;
  title: string;
  eyebrow?: string;
  onSeeAll?: () => void;
}) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex flex-col items-start gap-0.5 shrink-0">
          <span className="tracked-caps text-[9px] text-[color:var(--amber)]/85" style={{ letterSpacing: '0.28em' }}>
            Reel · {reelNumber(index)}
          </span>
          <span className="reel mt-1" aria-hidden />
        </div>
        <div className="hairline-v hidden sm:block self-stretch" aria-hidden />
        <div className="min-w-0">
          {eyebrow && (
            <p className="tracked-caps text-[9.5px] text-muted-foreground/80 mb-0.5">
              {eyebrow}
            </p>
          )}
          <h2 className="font-display text-[20px] sm:text-[24px] lg:text-[28px] leading-[1.05] truncate">
            {title}
          </h2>
        </div>
      </div>
      {onSeeAll && (
        <button
          onClick={onSeeAll}
          className="press-feedback group/all shrink-0 flex items-center gap-1.5 tracked-caps text-[10px] text-muted-foreground hover:text-[color:var(--amber)] transition-colors"
        >
          <span className="hidden sm:inline">See all</span>
          <span className="sm:hidden">All</span>
          <ArrowUpRight className="h-3 w-3 transition-transform group-hover/all:translate-x-0.5 group-hover/all:-translate-y-0.5" />
        </button>
      )}
    </div>
  );
}

function GenreChip({
  name,
  type,
  onClick,
}: {
  name: string;
  type: 'movie' | 'tv';
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group relative shrink-0 min-w-[170px] sm:min-w-[195px] press-feedback text-left overflow-hidden bg-card/50 hover:bg-[color:var(--amber-soft)] backdrop-blur-sm border border-[color:var(--hairline)] hover:border-[color:var(--amber-soft)] transition-all duration-300"
      style={{ borderRadius: 'calc(var(--radius) - 1px)' }}
    >
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <ArrowUpRight className="h-3 w-3 text-[color:var(--amber)]" />
      </div>
      <div className="px-3.5 py-3 sm:px-4 sm:py-3.5 space-y-1">
        <span className="tracked-caps text-[8.5px] text-muted-foreground/80" style={{ letterSpacing: '0.26em' }}>
          {type === 'movie' ? 'Genre · Film' : 'Genre · Series'}
        </span>
        <p className="font-display text-[15px] sm:text-[17px] leading-tight truncate group-hover:text-[color:var(--amber)] transition-colors">
          {name}
        </p>
      </div>
      {/* sprocket-hole strip */}
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-[color:var(--amber)]/0 group-hover:bg-[color:var(--amber)] transition-colors" />
    </button>
  );
}

function ProviderChip({
  name,
  logoSrc,
  type,
  onClick,
}: {
  name: string;
  logoSrc: string | null;
  type: 'movie' | 'tv';
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group shrink-0 min-w-[195px] press-feedback bg-card/50 hover:bg-card backdrop-blur-sm border border-[color:var(--hairline)] hover:border-[color:var(--amber-soft)] transition-all duration-300 px-3 py-2.5 flex items-center gap-3"
      style={{ borderRadius: 'calc(var(--radius) - 1px)' }}
    >
      <div
        className="relative h-10 w-10 shrink-0 overflow-hidden bg-[color:var(--ink-deep)]"
        style={{ borderRadius: '4px', border: '1px solid var(--hairline)' }}
      >
        {logoSrc ? (
          <Image
            src={logoSrc}
            alt={name}
            fill
            sizes="40px"
            className="object-contain p-1"
            unoptimized={isProtectedApiImageSrc(logoSrc)}
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1 text-left">
        <p className="tracked-caps text-[8.5px] text-muted-foreground/70" style={{ letterSpacing: '0.26em' }}>
          Stream · {type === 'movie' ? 'Film' : 'Series'}
        </p>
        <p className="text-sm font-medium leading-tight truncate group-hover:text-[color:var(--amber)] transition-colors">
          {name}
        </p>
      </div>
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 group-hover:text-[color:var(--amber)] transition-colors" />
    </button>
  );
}

function SectionRow({
  index,
  section,
  onOpenItem,
  onSeeAll,
  onPickGenre,
  onPickProvider,
}: {
  index: number;
  section: DiscoverSection;
  onOpenItem: (item: DiscoverItem) => void;
  onSeeAll: (section: DiscoverSection) => void;
  onPickGenre: (genreId: number, type: 'movie' | 'show') => void;
  onPickProvider: (providerId: number, type: 'movie' | 'show') => void;
}) {
  const eyebrow =
    section.type === 'media'
      ? section.mediaType === 'movie'
        ? 'Film selection'
        : section.mediaType === 'tv'
          ? 'Series selection'
          : 'Mixed programme'
      : section.type === 'genre'
        ? 'Browse by genre'
        : 'Streaming services';

  return (
    <section className="space-y-3 sm:space-y-4">
      <ReelHeader
        index={index}
        title={section.title}
        eyebrow={eyebrow}
        onSeeAll={section.type === 'media' ? () => onSeeAll(section) : undefined}
      />
      <div className="hairline" aria-hidden />

      {section.type === 'media' && (
        <div className="-mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="flex gap-3 sm:gap-4 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-hide">
            {(section.items as DiscoverItem[]).map((item) => (
              <div key={`${item.mediaType}-${item.tmdbId}`} className="snap-start">
                <MediaPoster item={item} onClick={onOpenItem} />
              </div>
            ))}
          </div>
        </div>
      )}

      {section.type === 'genre' && (
        <div className="-mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-hide">
            {(section.items as Array<{ id: number; name: string; type: 'movie' | 'tv' }>).map((genre) => (
              <GenreChip
                key={`${genre.type}-${genre.id}`}
                name={genre.name}
                type={genre.type}
                onClick={() => onPickGenre(genre.id, genre.type === 'movie' ? 'movie' : 'show')}
              />
            ))}
          </div>
        </div>
      )}

      {section.type === 'provider' && (
        <div className="-mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-hide">
            {(section.items as Array<{ id: number; name: string; logoPath: string | null; type: 'movie' | 'tv' }>).map((provider) => {
              const providerLogoPath = provider.logoPath ? `https://image.tmdb.org/t/p/w185${provider.logoPath}` : null;
              const providerLogoSrc = providerLogoPath
                ? (toCachedImageSrc(providerLogoPath, 'tmdb') || providerLogoPath)
                : null;
              return (
                <ProviderChip
                  key={`${provider.type}-${provider.id}`}
                  name={provider.name}
                  type={provider.type}
                  logoSrc={providerLogoSrc}
                  onClick={() => onPickProvider(provider.id, provider.type === 'movie' ? 'movie' : 'show')}
                />
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function DiscoverMarquee({ year }: { year: number }) {
  return (
    <div className="relative -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8">
      <div className="flex items-center gap-2 pt-1.5 pb-2">
        <span className="marquee-dot" aria-hidden />
        <span className="tracked-caps text-[9.5px] text-[color:var(--amber)]/85">
          Now Showing · Live from TMDB
        </span>
        <div className="hairline flex-1" aria-hidden />
        <span className="tracked-caps text-[9.5px] text-muted-foreground/60 font-mono tabular hidden sm:inline" style={{ letterSpacing: '0.22em' }}>
          MMXXVI · {year}
        </span>
      </div>
    </div>
  );
}

export default function DiscoverPage() {
  const searchParams = useSearchParams();
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

  const [personFilter, setPersonFilter] = useState<{ id: number; name: string } | null>(null);
  const [query, setQuery] = useState('');
  const [internalQuery, setInternalQuery] = useState('');
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

  const router = useRouter();
  const currentYear = useMemo(() => new Date().getFullYear(), []);

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
    () =>
      'grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] xl:grid-cols-[repeat(auto-fill,minmax(186px,1fr))] gap-3 sm:gap-4 lg:gap-5',
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
      || personFilter
    );
  }, [manualBrowseMode, query, hasAdvancedFilters, activeSectionKey, discoverSort, discoverContentType, personFilter]);

  const visibleSections = useMemo(() => {
    if (discoverContentType === 'all') return sections;

    return sections.filter((section) => {
      if (!section.mediaType || section.mediaType === 'all') {
        return section.key === 'providers';
      }
      if (discoverContentType === 'movie') return section.mediaType === 'movie';
      if (discoverContentType === 'show') return section.mediaType === 'tv';
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
    if (discoverFilters.companies.length) params.set('companies', discoverFilters.companies.join(','));
    if (discoverFilters.releaseState) params.set('releaseState', discoverFilters.releaseState);
    if (personFilter) {
      params.set('with_people', String(personFilter.id));
    }

    return params.toString();
  }, [
    query,
    discoverContentType,
    discoverSort,
    discoverSortDirection,
    discoverFilters,
    activeSectionKey,
    personFilter,
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

  // Debounced search
  useEffect(() => {
    if (internalQuery === '') {
      setQuery('');
      return;
    }
    const t = setTimeout(() => setQuery(internalQuery), 700);
    return () => clearTimeout(t);
  }, [internalQuery]);

  useEffect(() => {
    fetchSections();
    fetchFiltersMeta();
  }, [fetchSections, fetchFiltersMeta]);

  // Handle person URL params (from movie detail cast/crew links)
  useEffect(() => {
    const rawPersonId = searchParams.get('person');
    const personName = searchParams.get('personName')?.trim() || '';
    const personId = Number(rawPersonId);

    const hasValidPerson = Number.isFinite(personId) && personId > 0 && Boolean(personName);
    if (hasValidPerson) {
      setPersonFilter({ id: personId, name: personName });
      setDiscoverContentType('movie');
      setDiscoverSort('popular');
      setManualBrowseMode(true);
      return;
    }

    setPersonFilter(null);
    setManualBrowseMode(false);
  }, [
    searchParams,
    setPersonFilter,
    setDiscoverContentType,
    setDiscoverSort,
    setManualBrowseMode,
  ]);

  // Handle companies/networks URL params (from detail page links)
  useEffect(() => {
    const rawCompanies = searchParams.get('companies');
    const rawNetworks = searchParams.get('networks');
    const rawContentType = searchParams.get('contentType');
    if (!rawCompanies && !rawNetworks) return;

    const parseIds = (raw: string | null) =>
      raw
        ? raw.split(',').map((v) => Number(v.trim())).filter((v) => Number.isFinite(v) && v > 0)
        : [];

    const companyIds = parseIds(rawCompanies);
    const networkIds = parseIds(rawNetworks);
    if (!companyIds.length && !networkIds.length) return;

    const ct = rawContentType === 'movie' || rawContentType === 'show' ? rawContentType : 'all';
    setDiscoverContentType(ct);
    setDiscoverSort('popular');
    setDiscoverFilters({
      ...DEFAULT_DISCOVER_FILTERS,
      companies: companyIds,
      networks: networkIds,
    });
    setManualBrowseMode(true);
  }, [
    searchParams,
    setDiscoverContentType,
    setDiscoverSort,
    setDiscoverFilters,
    setManualBrowseMode,
  ]);

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
    router.push(`/discover/${item.mediaType === 'movie' ? 'movie' : 'tv'}/${item.tmdbId}`);
  }, [router]);

  const handleOpenFilters = useCallback(() => {
    setDraftFilters(discoverFilters);
    setDraftSort(discoverSort);
    setDraftSortDirection(discoverSortDirection);
    setFiltersOpen(true);
  }, [discoverFilters, discoverSort, discoverSortDirection]);

  const handleSelectContentType = useCallback((type: 'all' | 'movie' | 'show') => {
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
    setInternalQuery('');
    setManualBrowseMode(false);
    setPersonFilter(null);
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

  return (
    <div className="space-y-3 sm:space-y-4 animate-content-in">
      <DiscoverMarquee year={currentYear} />

      {/* ─── Sticky controls strip ─────────────────────────────────────── */}
      <div
        className="sticky z-30 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 pt-2 pb-3 bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70"
        style={{ top: 'var(--header-height, 0px)' }}
      >
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px"
          style={{ background: 'var(--hairline)' }}
        />

        {/* Search row */}
        <div className="flex items-stretch gap-2.5">
          <div className="relative flex-1 group">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70 group-focus-within:text-[color:var(--amber)] transition-colors" />
            <Input
              placeholder="Search the archive — title, person, genre…"
              value={internalQuery}
              onChange={(e) => setInternalQuery(e.target.value)}
              className="pl-10 pr-10 h-11 text-[14px] bg-card/40"
            />
            {internalQuery && (
              <button
                onClick={() => {
                  setInternalQuery('');
                  setQuery('');
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 rounded-md hover:bg-accent flex items-center justify-center"
                aria-label="Clear"
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
          <button
            onClick={handleOpenFilters}
            className="press-feedback relative h-11 px-3.5 inline-flex items-center gap-2 border border-[color:var(--hairline)] bg-card/50 backdrop-blur-sm hover:bg-[color:var(--amber-soft)] hover:border-[color:var(--amber-soft)] transition-colors"
            style={{ borderRadius: 'calc(var(--radius) - 1px)' }}
            aria-label="Advanced filters"
          >
            <Filter className="h-4 w-4" />
            <span className="tracked-caps text-[10px] hidden sm:inline">Filters</span>
            {activeAdvancedFilterCount > 0 && (
              <span
                className="ml-0.5 inline-flex items-center justify-center min-w-[20px] h-[20px] px-1 text-[10px] font-mono tabular font-semibold bg-[color:var(--amber)] text-[color:var(--primary-foreground)]"
                style={{ borderRadius: '3px' }}
              >
                {activeAdvancedFilterCount > 9 ? '9+' : activeAdvancedFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Type tabs — editorial underline strip */}
        <div className="mt-3 flex items-end justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-0.5 sm:gap-1 overflow-x-auto scrollbar-hide -mx-1 px-1">
            {TYPE_OPTIONS.map((option) => {
              const Icon = option.icon;
              const active = discoverContentType === option.value;
              return (
                <button
                  key={option.value}
                  onClick={() => handleSelectContentType(option.value as 'all' | 'movie' | 'show')}
                  className={`relative px-3 py-2 inline-flex items-center gap-2 whitespace-nowrap transition-colors ${
                    active ? 'text-foreground' : 'text-muted-foreground/70 hover:text-foreground'
                  }`}
                >
                  <Icon className={`h-3.5 w-3.5 ${active ? 'text-[color:var(--amber)]' : ''}`} />
                  <span className="font-display text-[14px] sm:text-[15px]" style={{ letterSpacing: '-0.01em' }}>
                    {option.label}
                  </span>
                  <span className="tracked-caps text-[8.5px] text-muted-foreground/60 font-mono tabular hidden sm:inline" style={{ letterSpacing: '0.22em' }}>
                    · {option.code}
                  </span>
                  <span
                    aria-hidden
                    className={`absolute left-2 right-2 -bottom-px h-px transition-all duration-300 ${
                      active ? 'bg-[color:var(--amber)] opacity-100' : 'bg-foreground/30 opacity-0'
                    }`}
                  />
                  {active && (
                    <span
                      aria-hidden
                      className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-1 h-1 rounded-full bg-[color:var(--amber)]"
                      style={{ boxShadow: '0 0 8px var(--amber-glow)' }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {/* Sort selector — inline marquee row */}
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide -mx-1 px-1">
            <span className="tracked-caps text-[9px] text-muted-foreground/60 mr-1 hidden sm:inline" style={{ letterSpacing: '0.24em' }}>
              Sort ·
            </span>
            {SORT_OPTIONS.map((option, i) => {
              const active = discoverSort === option.value;
              const Icon = option.icon;
              return (
                <div key={option.value} className="flex items-center">
                  {i > 0 && <span className="text-muted-foreground/30 mx-0.5 text-[10px]">·</span>}
                  <button
                    onClick={() => handleSelectSort(option.value)}
                    className={`px-2 py-1 inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                      active ? 'text-[color:var(--amber)]' : 'text-muted-foreground/75 hover:text-foreground'
                    }`}
                  >
                    <Icon className="h-3 w-3" />
                    <span className="tracked-caps text-[10px]" style={{ letterSpacing: '0.2em' }}>
                      {option.label}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {rateLimitInfo && (
          <div
            className="mt-3 flex items-center gap-3 px-3 py-2 border border-[color:var(--amber)]/30 bg-[color:var(--amber-soft)]"
            style={{ borderRadius: 'calc(var(--radius) - 1px)' }}
          >
            <span className="marquee-dot shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="tracked-caps text-[9.5px] text-[color:var(--amber)]">
                Reel jam · TMDB rate limit
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {rateLimitCountdown != null
                  ? `Re-spool in ${formatWait(rateLimitCountdown)}.`
                  : rateLimitInfo.retryAt
                    ? `Retry around ${new Date(rateLimitInfo.retryAt).toLocaleTimeString()}.`
                    : `${rateLimitInfo.message}. Please wait and try again.`}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ─── Sections (browse home) ────────────────────────────────────── */}
      {!gridMode && (
        <div className="space-y-7 sm:space-y-10 lg:space-y-12">
          {loadingSections ? (
            <PageSpinner />
          ) : (
            visibleSections.map((section, i) => (
              <SectionRow
                key={section.key}
                index={i}
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

      {/* ─── Grid mode (search / filtered) ─────────────────────────────── */}
      {gridMode && (
        <div className="space-y-5">
          {personFilter && (
            <div
              className="flex items-center gap-3 px-3.5 py-2.5 border border-[color:var(--amber)]/30 bg-[color:var(--amber-soft)]"
              style={{ borderRadius: 'calc(var(--radius) - 1px)' }}
            >
              <User className="h-4 w-4 text-[color:var(--amber)] shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="tracked-caps text-[9px] text-[color:var(--amber)]/80" style={{ letterSpacing: '0.24em' }}>
                  Filtered by person
                </p>
                <p className="font-display text-[15px] truncate">{personFilter.name}</p>
              </div>
              <button
                onClick={() => setPersonFilter(null)}
                className="press-feedback shrink-0 h-7 w-7 rounded-md flex items-center justify-center hover:bg-background/40"
                aria-label="Clear person"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <div className="flex items-end justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <span className="reel" aria-hidden />
              <div className="hairline-v hidden sm:block self-stretch" aria-hidden />
              <div className="min-w-0">
                <p className="tracked-caps text-[9.5px] text-[color:var(--amber)]/85" style={{ letterSpacing: '0.26em' }}>
                  {personFilter
                    ? `With ${personFilter.name}`
                    : activeSectionKey
                      ? `Section · ${activeSectionKey.replaceAll('_', ' ')}`
                      : query
                        ? 'Search results'
                        : 'Custom selection'}
                </p>
                <h2 className="font-display text-[22px] sm:text-[28px] leading-tight">
                  {query ? <>&ldquo;{query}&rdquo;</> : 'Discover Results'}
                </h2>
                <p className="font-mono tabular text-[10px] text-muted-foreground/70 mt-0.5">
                  {items.length} {items.length === 1 ? 'title' : 'titles'} · page {page} of {totalPages}
                </p>
              </div>
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
              <Button variant="outline" size="sm" onClick={goToDiscoverHome} className="h-8 px-3 text-xs">
                Back to Discover
              </Button>
            </div>
          </div>

          <div className="hairline" aria-hidden />

          {loadingItems ? (
            <PageSpinner />
          ) : items.length === 0 ? (
            <div
              className="border border-[color:var(--hairline)] bg-card/40 p-10 text-center space-y-3"
              style={{ borderRadius: 'calc(var(--radius) - 1px)' }}
            >
              <div className="mx-auto h-10 w-10 rounded-full border border-[color:var(--hairline)] flex items-center justify-center">
                <Search className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className="tracked-caps text-[10px] text-muted-foreground">No matches found</p>
              <p className="font-display text-[18px]">Empty reel.</p>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                The booth came back empty. Try loosening the filters or a different title.
              </p>
              <Button variant="outline" onClick={resetFilters} className="mt-2">
                Reset filters
              </Button>
            </div>
          ) : (
            <>
              <div className={gridClassName}>
                {items.map((item) => (
                  <MediaPoster
                    key={`${item.mediaType}-${item.tmdbId}`}
                    item={item}
                    onClick={handleOpenItem}
                    variant="grid"
                  />
                ))}
              </div>

              {page < totalPages && (
                <div className="flex justify-center pt-4">
                  <Button
                    variant="outline"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="cta-sheen min-w-[180px]"
                  >
                    {loadingMore ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="tracked-caps text-[10px]">Loading reel</span>
                      </>
                    ) : (
                      <span className="tracked-caps text-[10px]">Next reel ↓</span>
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ─── Advanced Filters Sheet ────────────────────────────────────── */}
      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="right" className="w-[92vw] sm:max-w-md p-0 flex flex-col bg-background">
          <SheetHeader className="px-5 pt-5 pb-3 space-y-1 border-b border-[color:var(--hairline)]">
            <div className="flex items-center gap-2">
              <span className="marquee-dot" aria-hidden />
              <span className="tracked-caps text-[9.5px] text-[color:var(--amber)]/85">
                Projection settings
              </span>
            </div>
            <SheetTitle className="font-display text-[24px] leading-tight tracking-[-0.02em]">
              Advanced Filters
            </SheetTitle>
            <p className="text-[12px] text-muted-foreground">
              Refine the booth — by year, runtime, rating, language, providers and more.
            </p>
          </SheetHeader>

          <div className="px-5 py-5 overflow-y-auto flex-1 space-y-6">
            <div className="space-y-2">
              <p className="tracked-caps text-[9.5px] text-muted-foreground/80">Sort by</p>
              <div className="grid grid-cols-2 gap-1.5">
                {SORT_OPTIONS.map((option) => {
                  const active = draftSort === option.value;
                  const Icon = option.icon;
                  return (
                    <button
                      key={option.value}
                      onClick={() => setDraftSort(option.value)}
                      className={`px-3 py-2.5 border text-left text-sm flex items-center gap-2 transition-all ${
                        active
                          ? 'border-[color:var(--amber)] text-[color:var(--amber)] bg-[color:var(--amber-soft)]'
                          : 'border-[color:var(--hairline)] text-muted-foreground hover:border-foreground/30'
                      }`}
                      style={{ borderRadius: 'calc(var(--radius) - 2px)' }}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span className="font-medium">{option.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <p className="tracked-caps text-[9.5px] text-muted-foreground/80">Direction</p>
              <div className="grid grid-cols-2 gap-1.5">
                {(['desc', 'asc'] as const).map((dir) => {
                  const active = draftSortDirection === dir;
                  return (
                    <button
                      key={dir}
                      onClick={() => setDraftSortDirection(dir)}
                      className={`px-3 py-2.5 border tracked-caps text-[10px] transition-all ${
                        active
                          ? 'border-[color:var(--amber)] text-[color:var(--amber)] bg-[color:var(--amber-soft)]'
                          : 'border-[color:var(--hairline)] text-muted-foreground hover:border-foreground/30'
                      }`}
                      style={{ borderRadius: 'calc(var(--radius) - 2px)' }}
                    >
                      {dir === 'desc' ? '↓ Descending' : '↑ Ascending'}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="hairline" aria-hidden />

            <div className="space-y-3">
              <p className="tracked-caps text-[9.5px] text-muted-foreground/80">Year window</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="tracked-caps text-[8.5px] text-muted-foreground/70 mb-1 block">From</label>
                  <Input
                    value={draftFilters.yearFrom}
                    onChange={(e) => setDraftFilters({ ...draftFilters, yearFrom: e.target.value })}
                    placeholder="1995"
                    inputMode="numeric"
                    className="font-mono tabular"
                  />
                </div>
                <div>
                  <label className="tracked-caps text-[8.5px] text-muted-foreground/70 mb-1 block">To</label>
                  <Input
                    value={draftFilters.yearTo}
                    onChange={(e) => setDraftFilters({ ...draftFilters, yearTo: e.target.value })}
                    placeholder="2026"
                    inputMode="numeric"
                    className="font-mono tabular"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <p className="tracked-caps text-[9.5px] text-muted-foreground/80">Runtime · minutes</p>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={draftFilters.runtimeMin}
                  onChange={(e) => setDraftFilters({ ...draftFilters, runtimeMin: e.target.value })}
                  placeholder="Min · 45"
                  inputMode="numeric"
                  className="font-mono tabular"
                />
                <Input
                  value={draftFilters.runtimeMax}
                  onChange={(e) => setDraftFilters({ ...draftFilters, runtimeMax: e.target.value })}
                  placeholder="Max · 180"
                  inputMode="numeric"
                  className="font-mono tabular"
                />
              </div>
            </div>

            <div className="space-y-3">
              <p className="tracked-caps text-[9.5px] text-muted-foreground/80">Rating</p>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={draftFilters.ratingMin}
                  onChange={(e) => setDraftFilters({ ...draftFilters, ratingMin: e.target.value })}
                  placeholder="Min · 7.5"
                  inputMode="decimal"
                  className="font-mono tabular"
                />
                <Input
                  value={draftFilters.ratingMax}
                  onChange={(e) => setDraftFilters({ ...draftFilters, ratingMax: e.target.value })}
                  placeholder="Max · 10"
                  inputMode="decimal"
                  className="font-mono tabular"
                />
              </div>
              <Input
                value={draftFilters.voteCountMin}
                onChange={(e) => setDraftFilters({ ...draftFilters, voteCountMin: e.target.value })}
                placeholder="Vote count min · 500"
                inputMode="numeric"
                className="font-mono tabular"
              />
            </div>

            <div className="space-y-3">
              <p className="tracked-caps text-[9.5px] text-muted-foreground/80">Locale</p>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={draftFilters.language}
                  onChange={(e) => setDraftFilters({ ...draftFilters, language: e.target.value })}
                  placeholder="Language · en"
                />
                <Input
                  value={draftFilters.region}
                  onChange={(e) => setDraftFilters({ ...draftFilters, region: e.target.value })}
                  placeholder="Region · US"
                />
              </div>
            </div>

            <div className="hairline" aria-hidden />

            <div className="space-y-2">
              <p className="tracked-caps text-[9.5px] text-muted-foreground/80">Release state</p>
              <div className="grid grid-cols-3 gap-1.5">
                {(['', 'released', 'upcoming', 'airing', 'ended'] as const).map((state) => {
                  const active = draftFilters.releaseState === state;
                  return (
                    <button
                      key={state || 'all'}
                      onClick={() =>
                        setDraftFilters({
                          ...draftFilters,
                          releaseState: state,
                        })
                      }
                      className={`px-2 py-2 border tracked-caps text-[9.5px] transition-all ${
                        active
                          ? 'border-[color:var(--amber)] text-[color:var(--amber)] bg-[color:var(--amber-soft)]'
                          : 'border-[color:var(--hairline)] text-muted-foreground hover:border-foreground/30'
                      }`}
                      style={{ borderRadius: 'calc(var(--radius) - 2px)' }}
                    >
                      {state || 'Any'}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-end justify-between">
                <p className="tracked-caps text-[9.5px] text-muted-foreground/80">Genres</p>
                {draftFilters.genres.length > 0 && (
                  <button
                    onClick={() => setDraftFilters({ ...draftFilters, genres: [] })}
                    className="tracked-caps text-[9px] text-muted-foreground hover:text-[color:var(--amber)]"
                  >
                    Clear · {draftFilters.genres.length}
                  </button>
                )}
              </div>
              <div className="rounded-md border border-[color:var(--hairline)] p-2.5 bg-card/40">
                <div className="flex flex-wrap gap-1.5">
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
                        className={`px-2.5 py-1 text-[11px] border transition-all ${
                          active
                            ? 'border-[color:var(--amber)] text-[color:var(--amber)] bg-[color:var(--amber-soft)]'
                            : 'border-[color:var(--hairline)] text-muted-foreground hover:text-foreground hover:border-foreground/30'
                        }`}
                        style={{ borderRadius: '999px' }}
                      >
                        {genre.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-end justify-between">
                <p className="tracked-caps text-[9.5px] text-muted-foreground/80">Streaming providers</p>
                {draftFilters.providers.length > 0 && (
                  <button
                    onClick={() => setDraftFilters({ ...draftFilters, providers: [] })}
                    className="tracked-caps text-[9px] text-muted-foreground hover:text-[color:var(--amber)]"
                  >
                    Clear · {draftFilters.providers.length}
                  </button>
                )}
              </div>
              <div className="rounded-md border border-[color:var(--hairline)] p-2.5 bg-card/40">
                <div className="flex flex-wrap gap-1.5">
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
                        className={`px-2.5 py-1 text-[11px] border transition-all ${
                          active
                            ? 'border-[color:var(--amber)] text-[color:var(--amber)] bg-[color:var(--amber-soft)]'
                            : 'border-[color:var(--hairline)] text-muted-foreground hover:text-foreground hover:border-foreground/30'
                        }`}
                        style={{ borderRadius: '999px' }}
                      >
                        {provider.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-end justify-between">
                <p className="tracked-caps text-[9.5px] text-muted-foreground/80">Networks</p>
                {draftFilters.networks.length > 0 && (
                  <button
                    onClick={() => setDraftFilters({ ...draftFilters, networks: [] })}
                    className="tracked-caps text-[9px] text-muted-foreground hover:text-[color:var(--amber)]"
                  >
                    Clear · {draftFilters.networks.length}
                  </button>
                )}
              </div>
              <div className="rounded-md border border-[color:var(--hairline)] p-2.5 bg-card/40">
                <div className="flex flex-wrap gap-1.5">
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
                        className={`px-2.5 py-1 text-[11px] border transition-all ${
                          active
                            ? 'border-[color:var(--amber)] text-[color:var(--amber)] bg-[color:var(--amber-soft)]'
                            : 'border-[color:var(--hairline)] text-muted-foreground hover:text-foreground hover:border-foreground/30'
                        }`}
                        style={{ borderRadius: '999px' }}
                      >
                        {network.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <SheetFooter className="border-t border-[color:var(--hairline)] px-5 py-4">
            <div className="grid grid-cols-2 gap-2 w-full">
              <Button
                variant="outline"
                onClick={() => {
                  setDraftFilters({ ...DEFAULT_DISCOVER_FILTERS });
                  setDraftSort('trending');
                  setDraftSortDirection('desc');
                }}
              >
                <span className="tracked-caps text-[10px]">Reset</span>
              </Button>
              <Button
                className="cta-sheen projector-glow"
                onClick={() => {
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
                }}
              >
                <span className="tracked-caps text-[10px]">Roll Reel</span>
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
