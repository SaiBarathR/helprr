'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useMemo } from 'react';
import { CheckCircle2, Film, Star, Tv } from 'lucide-react';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { Carousel, EditModePlaceholder, SectionHeader } from '@/components/widgets/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { toCachedImageSrc, isProtectedApiImageSrc } from '@/lib/image';
import { useUIStore } from '@/lib/store';
import {
  BUILTIN_DISCOVER_SECTIONS,
  type DiscoverLayoutCustomFilters,
  type DiscoverLayoutSection,
} from '@/lib/discover-layout-config';
import type {
  DiscoverGenre,
  DiscoverItem,
  DiscoverProvider,
  DiscoverResponse,
  DiscoverSection,
} from '@/types';

interface DiscoverSectionWidgetProps {
  sectionId: string;
  size: 'small' | 'medium' | 'large';
  refreshInterval: number;
  editMode?: boolean;
}

const CLIENT_CACHE_MS = 5 * 60 * 1000;

// ---------- caches ----------

let sectionsPromise: Promise<DiscoverResponse> | null = null;
let sectionsPromiseTime = 0;

function fetchSectionsCached(): Promise<DiscoverResponse> {
  const now = Date.now();
  if (sectionsPromise && now - sectionsPromiseTime < CLIENT_CACHE_MS) return sectionsPromise;
  sectionsPromiseTime = now;
  sectionsPromise = fetch('/api/discover?mode=sections')
    .then((res) => {
      if (!res.ok) throw new Error('Failed to fetch Discover sections');
      return res.json() as Promise<DiscoverResponse>;
    })
    .catch((err) => {
      sectionsPromise = null;
      sectionsPromiseTime = 0;
      throw err;
    });
  return sectionsPromise;
}

interface CustomCache {
  promise: Promise<DiscoverItem[]>;
  time: number;
}

const customCache = new Map<string, CustomCache>();

function buildCustomQuery(filters: DiscoverLayoutCustomFilters): string {
  const params = new URLSearchParams();
  params.set('mode', 'browse');
  params.set('page', '1');
  params.set('contentType', filters.contentType);
  params.set('sortBy', filters.sortBy);
  params.set('sortOrder', filters.sortOrder);
  if (filters.genres?.length) params.set('genres', filters.genres.join(','));
  if (filters.yearFrom) params.set('yearFrom', filters.yearFrom);
  if (filters.yearTo) params.set('yearTo', filters.yearTo);
  if (filters.runtimeMin) params.set('runtimeMin', filters.runtimeMin);
  if (filters.runtimeMax) params.set('runtimeMax', filters.runtimeMax);
  if (filters.ratingMin) params.set('ratingMin', filters.ratingMin);
  if (filters.ratingMax) params.set('ratingMax', filters.ratingMax);
  if (filters.voteCountMin) params.set('voteCountMin', filters.voteCountMin);
  if (filters.language) params.set('language', filters.language);
  if (filters.region) params.set('region', filters.region);
  if (filters.providers?.length) params.set('providers', filters.providers.join(','));
  if (filters.networks?.length) params.set('networks', filters.networks.join(','));
  if (filters.companies?.length) params.set('companies', filters.companies.join(','));
  if (filters.releaseState) params.set('releaseState', filters.releaseState);
  return params.toString();
}

function fetchCustomCached(filters: DiscoverLayoutCustomFilters): Promise<DiscoverItem[]> {
  const query = buildCustomQuery(filters);
  const now = Date.now();
  const cached = customCache.get(query);
  if (cached && now - cached.time < CLIENT_CACHE_MS) return cached.promise;
  const promise = fetch(`/api/discover?${query}`)
    .then((res) => {
      if (!res.ok) throw new Error('Failed to fetch Discover carousel');
      return res.json() as Promise<DiscoverResponse>;
    })
    .then((data) => (data.items ?? []).slice(0, 20))
    .catch((err) => {
      customCache.delete(query);
      throw err;
    });
  customCache.set(query, { promise, time: now });
  return promise;
}

// ---------- helpers ----------

function detailHref(item: DiscoverItem): string {
  return item.mediaType === 'movie'
    ? `/discover/movie/${item.tmdbId}`
    : `/discover/tv/${item.tmdbId}`;
}

function buildGenreHref(genreId: number, type: 'movie' | 'tv'): string {
  const ct = type === 'movie' ? 'movie' : 'show';
  return `/discover?genres=${genreId}&contentType=${ct}`;
}

function buildProviderHref(providerId: number, type: 'movie' | 'tv'): string {
  const ct = type === 'movie' ? 'movie' : 'show';
  return `/discover?providers=${providerId}&contentType=${ct}`;
}

// ---------- subviews ----------

function MediaCarouselView({
  title,
  viewAllHref,
  items,
  size,
}: {
  title: string;
  viewAllHref: string;
  items: DiscoverItem[];
  size: 'small' | 'medium' | 'large';
}) {
  if (size === 'medium') {
    return (
      <div>
        <SectionHeader title={title} href={viewAllHref} />
        <div className="space-y-1.5">
          {items.slice(0, 4).map((item) => {
            const Icon = item.mediaType === 'movie' ? Film : Tv;
            const badgeColor = item.mediaType === 'movie' ? 'bg-sky-500/80' : 'bg-violet-500/80';
            const metadata: string[] = [];
            if (item.year != null) metadata.push(String(item.year));
            if (item.rating > 0) metadata.push(`${item.rating.toFixed(1)}★`);
            return (
              <Link
                key={`${item.mediaType}-${item.tmdbId}`}
                href={detailHref(item)}
                className="flex items-center gap-2.5 rounded-xl bg-card px-3 py-2.5 hover:bg-muted/30 transition-colors"
              >
                <span className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${badgeColor}`}>
                  <Icon className="h-2.5 w-2.5 text-white" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{item.title}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{metadata.join(' · ')}</p>
                </div>
                {item.library?.exists && (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                )}
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader title={title} href={viewAllHref} />
      <Carousel>
        {items.map((item) => {
          const metadata: string[] = [];
          if (item.year != null) metadata.push(String(item.year));
          if (item.mediaType === 'tv') metadata.push('TV');
          return (
            <Link
              key={`${item.mediaType}-${item.tmdbId}`}
              href={detailHref(item)}
              className="snap-start shrink-0 w-[110px] group"
            >
              <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-muted mb-1.5 shadow-sm border border-border/30 group-hover:border-primary/40 transition-colors">
                {item.posterPath ? (
                  <Image
                    src={item.posterPath}
                    alt={item.title}
                    fill
                    sizes="110px"
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs p-2 text-center">
                    {item.title}
                  </div>
                )}
                {item.library?.exists && (
                  <div className="absolute left-1 top-1">
                    <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-emerald-500 text-white">
                      <CheckCircle2 className="h-3 w-3" />
                    </span>
                  </div>
                )}
                {item.rating > 0 && (
                  <div className="absolute right-1 top-1">
                    <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[9px] text-white">
                      <Star className="h-2 w-2 fill-yellow-400 text-yellow-400" />
                      {item.rating.toFixed(1)}
                    </span>
                  </div>
                )}
              </div>
              <p className="text-[11px] font-medium truncate leading-tight">{item.title}</p>
              <p className="text-[10px] text-muted-foreground truncate">{metadata.join(' · ')}</p>
            </Link>
          );
        })}
      </Carousel>
    </div>
  );
}

function GenreGridView({
  title,
  viewAllHref,
  items,
  size,
}: {
  title: string;
  viewAllHref: string;
  items: DiscoverGenre[];
  size: 'small' | 'medium' | 'large';
}) {
  const limit = size === 'medium' ? 6 : 12;
  return (
    <div>
      <SectionHeader title={title} href={viewAllHref} />
      <div className="grid grid-cols-2 gap-1.5">
        {items.slice(0, limit).map((genre) => (
          <Link
            key={`${genre.type}-${genre.id}`}
            href={buildGenreHref(genre.id, genre.type)}
            className="rounded-xl bg-card px-3 py-2.5 hover:bg-muted/30 transition-colors"
          >
            <p className="text-xs font-medium truncate">{genre.name}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

function ProviderGridView({
  title,
  viewAllHref,
  items,
  size,
}: {
  title: string;
  viewAllHref: string;
  items: DiscoverProvider[];
  size: 'small' | 'medium' | 'large';
}) {
  const limit = size === 'medium' ? 4 : 8;
  return (
    <div>
      <SectionHeader title={title} href={viewAllHref} />
      <div className="grid grid-cols-2 gap-1.5">
        {items.slice(0, limit).map((provider) => {
          const rawLogo = provider.logoPath ? `https://image.tmdb.org/t/p/w185${provider.logoPath}` : null;
          const logoSrc = rawLogo ? (toCachedImageSrc(rawLogo, 'tmdb') || rawLogo) : null;
          return (
            <Link
              key={`${provider.type}-${provider.id}`}
              href={buildProviderHref(provider.id, provider.type)}
              className="flex items-center gap-2 rounded-xl bg-card px-2.5 py-2 hover:bg-muted/30 transition-colors"
            >
              <div className="relative h-7 w-7 rounded bg-background/70 overflow-hidden shrink-0">
                {logoSrc && (
                  <Image
                    src={logoSrc}
                    alt={provider.name}
                    fill
                    sizes="28px"
                    className="object-contain"
                    unoptimized={isProtectedApiImageSrc(logoSrc)}
                  />
                )}
              </div>
              <p className="text-xs font-medium truncate">{provider.name}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function CarouselSkeleton({ title, size }: { title: string; size: 'small' | 'medium' | 'large' }) {
  return (
    <div>
      <SectionHeader title={title} />
      {size === 'medium' ? (
        <div className="flex flex-col gap-1.5">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-[44px] w-full rounded-xl shrink-0" />
          ))}
        </div>
      ) : (
        <div className="flex gap-3 overflow-hidden">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-[170px] w-[110px] rounded-xl shrink-0" />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- the widget ----------

const BUILTIN_MAP = new Map(BUILTIN_DISCOVER_SECTIONS.map((s) => [s.id, s] as const));

function resolveSection(sectionId: string, sections: DiscoverLayoutSection[] | undefined) {
  if (!sections) return null;
  return sections.find((s) => s.id === sectionId) ?? null;
}

export function DiscoverSectionWidget({
  sectionId,
  size,
  refreshInterval,
  editMode,
}: DiscoverSectionWidgetProps) {
  const safeInterval = Math.max(refreshInterval, CLIENT_CACHE_MS);
  const discoverLayout = useUIStore((s) => s.discoverLayout);

  const layoutSection = useMemo(
    () => resolveSection(sectionId, discoverLayout?.sections),
    [sectionId, discoverLayout],
  );

  const isBuiltinMedia = layoutSection?.type === 'builtin' && BUILTIN_MAP.get(sectionId)?.sectionType === 'media';
  const isBuiltinGenre = layoutSection?.type === 'builtin' && BUILTIN_MAP.get(sectionId)?.sectionType === 'genre';
  const isBuiltinProvider = layoutSection?.type === 'builtin' && BUILTIN_MAP.get(sectionId)?.sectionType === 'provider';
  const isCustom = layoutSection?.type === 'custom' && Boolean(layoutSection.filters);

  const needsSections = isBuiltinMedia || isBuiltinGenre || isBuiltinProvider;

  const {
    data: sectionsData,
    loading: sectionsLoading,
    error: sectionsError,
  } = useWidgetData<DiscoverResponse>({
    fetchFn: fetchSectionsCached,
    refreshInterval: safeInterval,
    enabled: needsSections,
  });

  const customFilters = isCustom ? layoutSection!.filters! : null;

  const {
    data: customItems,
    loading: customLoading,
    error: customError,
  } = useWidgetData<DiscoverItem[]>({
    fetchFn: () => fetchCustomCached(customFilters!),
    refreshInterval: safeInterval,
    enabled: isCustom,
  });

  if (!layoutSection) {
    if (editMode) {
      return <EditModePlaceholder title="Discover widget" message="Section was removed from Discover Layout" />;
    }
    return null;
  }

  const title = layoutSection.label;
  const viewAllHref = layoutSection.type === 'custom'
    ? `/discover`
    : `/discover?section=${layoutSection.id}`;

  if (isBuiltinMedia) {
    if (sectionsLoading && !sectionsData) return <CarouselSkeleton title={title} size={size} />;
    const section = sectionsData?.sections?.find((s): s is DiscoverSection => s.key === sectionId);
    const items = (section?.items as DiscoverItem[] | undefined) ?? [];
    if (sectionsError && items.length === 0) {
      return (
        <div className="flex h-full items-center justify-center bg-card p-4 rounded-xl text-xs text-red-500">
          {sectionsError}
        </div>
      );
    }
    if (items.length === 0) return editMode ? <EditModePlaceholder title={title} message="No items found" /> : null;
    return <MediaCarouselView title={title} viewAllHref={viewAllHref} items={items} size={size} />;
  }

  if (isBuiltinGenre) {
    if (sectionsLoading && !sectionsData) return <CarouselSkeleton title={title} size={size} />;
    const section = sectionsData?.sections?.find((s): s is DiscoverSection => s.key === sectionId);
    const items = (section?.items as DiscoverGenre[] | undefined) ?? [];
    if (sectionsError && items.length === 0) {
      return (
        <div className="flex h-full items-center justify-center bg-card p-4 rounded-xl text-xs text-red-500">
          {sectionsError}
        </div>
      );
    }
    if (items.length === 0) return editMode ? <EditModePlaceholder title={title} message="No genres found" /> : null;
    return <GenreGridView title={title} viewAllHref={viewAllHref} items={items} size={size} />;
  }

  if (isBuiltinProvider) {
    if (sectionsLoading && !sectionsData) return <CarouselSkeleton title={title} size={size} />;
    const section = sectionsData?.sections?.find((s): s is DiscoverSection => s.key === sectionId);
    const items = (section?.items as DiscoverProvider[] | undefined) ?? [];
    if (sectionsError && items.length === 0) {
      return (
        <div className="flex h-full items-center justify-center bg-card p-4 rounded-xl text-xs text-red-500">
          {sectionsError}
        </div>
      );
    }
    if (items.length === 0) return editMode ? <EditModePlaceholder title={title} message="No providers found" /> : null;
    return <ProviderGridView title={title} viewAllHref={viewAllHref} items={items} size={size} />;
  }

  if (isCustom) {
    if (customLoading && !customItems) return <CarouselSkeleton title={title} size={size} />;
    const items = customItems ?? [];
    if (customError && items.length === 0) {
      return (
        <div className="flex h-full items-center justify-center bg-card p-4 rounded-xl text-xs text-red-500">
          {customError}
        </div>
      );
    }
    if (items.length === 0) return editMode ? <EditModePlaceholder title={title} message="No items found" /> : null;
    return <MediaCarouselView title={title} viewAllHref={viewAllHref} items={items} size={size} />;
  }

  return editMode ? <EditModePlaceholder title={title} message="Unsupported section" /> : null;
}
