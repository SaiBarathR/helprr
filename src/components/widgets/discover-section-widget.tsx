'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { useElementSize } from '@/lib/widgets/use-element-size';
import { toCachedImageSrc } from '@/lib/image';
import { useUIStore } from '@/lib/store';
import {
  CAROUSEL_CARD_HEIGHT,
  CAROUSEL_CARD_WIDTH,
  CAROUSEL_GAP,
  FONT_MONO,
  HPR,
  LIST_ROW_HEIGHT,
  Poster,
  SECTION_HEADER_HEIGHT,
  SectionHeader,
  ViewModeToggle,
  toneFromString,
  mix,
} from './bento-primitives';
import { Film, Tv } from 'lucide-react';
import { useDashboardLayout } from './dashboard-layout-context';
import type { WidgetLayoutVariant } from '@/lib/widgets/types';
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
  refreshInterval: number;
  editMode?: boolean;
  narrow?: boolean;
  colSpan?: number;
  layoutVariant?: WidgetLayoutVariant;
  instanceId?: string;
}

const CLIENT_CACHE_MS = 5 * 60 * 1000;

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

function buildCustomDiscoverHref(filters: DiscoverLayoutCustomFilters): string {
  const params = new URLSearchParams();
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
  return `/discover?${params.toString()}`;
}

function MediaCarouselView({
  title,
  viewAllHref,
  items,
  limit,
  useList,
  toggleNode,
}: {
  title: string;
  viewAllHref: string;
  items: DiscoverItem[];
  limit: number;
  useList: boolean;
  toggleNode: React.ReactNode;
}) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const dynamicLimit = useList
    ? height > 0
      ? Math.max(limit, Math.ceil((height - SECTION_HEADER_HEIGHT) / LIST_ROW_HEIGHT) + 4)
      : limit
    : width > 0
      ? Math.max(limit, Math.ceil(width / (CAROUSEL_CARD_WIDTH + CAROUSEL_GAP)) + 4)
      : limit;
  const headerRight = (
    <>
      {toggleNode}
      <Link href={viewAllHref} style={{ color: 'inherit', textDecoration: 'none' }}>
        View all →
      </Link>
    </>
  );

  if (useList) {
    return (
      <div
        ref={ref}
        style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
      >
        <SectionHeader title={title} right={headerRight} />
        <div
          className="no-scrollbar scroll-fade-y"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
          }}
        >
          {items.slice(0, dynamicLimit).map((item) => {
            const isMovie = item.mediaType === 'movie';
            const typeColor = isMovie ? HPR.blue : HPR.purple;
            return (
              <Link
                key={`${item.mediaType}-${item.tmdbId}`}
                href={detailHref(item)}
                style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    padding: 8,
                    background: HPR.ink,
                    borderRadius: 12,
                  }}
                >
                  <Poster
                    width={48}
                    height={72}
                    label={item.title}
                    tone={toneFromString(item.title)}
                    fontSize={8}
                    imageUrl={item.posterPath ?? undefined}
                    check={Boolean(item.library?.exists)}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14,
                        color: HPR.fg,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        fontWeight: 500,
                      }}
                    >
                      {item.title}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: HPR.fgMute,
                        marginTop: 2,
                        wordBreak: 'break-word',
                      }}
                    >
                      {[item.year != null ? String(item.year) : null, isMovie ? 'Movie' : 'TV']
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                    {item.rating > 0 && (
                      <div
                        style={{
                          fontFamily: FONT_MONO,
                          fontSize: 12,
                          color: HPR.amber,
                          marginTop: 2,
                        }}
                      >
                        ★ {item.rating.toFixed(1)}
                      </div>
                    )}
                  </div>
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 6,
                      background: typeColor,
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      marginRight: 4,
                      marginTop: 2,
                      opacity: 0.85,
                    }}
                  >
                    {isMovie ? <Film size={11} strokeWidth={2.4} /> : <Tv size={11} strokeWidth={2.4} />}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div ref={ref}>
      <SectionHeader title={title} right={headerRight} />
      <div
        className="no-scrollbar"
        style={{ display: 'flex', gap: CAROUSEL_GAP, overflowX: 'auto', paddingBottom: 4 }}
      >
        {items.slice(0, dynamicLimit).map((item) => {
          const meta = [
            item.year != null ? String(item.year) : null,
            item.mediaType === 'tv' ? 'TV' : 'Movie',
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <Link
              key={`${item.mediaType}-${item.tmdbId}`}
              href={detailHref(item)}
              style={{
                width: CAROUSEL_CARD_WIDTH,
                flexShrink: 0,
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <Poster
                width={CAROUSEL_CARD_WIDTH}
                height={CAROUSEL_CARD_HEIGHT}
                label={item.title}
                tone={toneFromString(item.title)}
                imageUrl={item.posterPath ?? undefined}
                rating={item.rating > 0 ? item.rating.toFixed(1) : null}
                check={Boolean(item.library?.exists)}
              />
              <div
                style={{
                  fontSize: 11,
                  color: HPR.fg,
                  marginTop: 6,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  fontWeight: 500,
                }}
              >
                {item.title}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: HPR.fgMute,
                  fontFamily: FONT_MONO,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {meta}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function GenreGridView({
  title,
  viewAllHref,
  items,
  limit,
}: {
  title: string;
  viewAllHref: string;
  items: DiscoverGenre[];
  limit: number;
}) {
  const { ref, height } = useElementSize<HTMLDivElement>();
  // 2-column grid: each row holds 2 pills. Pill ~32px tall + 6px gap.
  const visibleCount = height > 0
    ? Math.max(limit, Math.ceil((height - 32) / 38) * 2 + 4)
    : limit;
  return (
    <div
      ref={ref}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
    >
      <SectionHeader
        title={title}
        right={
          <Link href={viewAllHref} style={{ color: 'inherit', textDecoration: 'none' }}>
            View all →
          </Link>
        }
      />
      <div
        className="no-scrollbar scroll-fade-y"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 6,
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          alignContent: 'start',
        }}
      >
        {items.slice(0, visibleCount).map((genre) => (
          <Link
            key={`${genre.type}-${genre.id}`}
            href={buildGenreHref(genre.id, genre.type)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: 32,
              background: HPR.ink,
              border: `1px solid ${HPR.hairline}`,
              borderRadius: 999,
              fontSize: 11,
              color: HPR.fg,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              textDecoration: 'none',
            }}
          >
            {genre.name}
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
  limit,
}: {
  title: string;
  viewAllHref: string;
  items: DiscoverProvider[];
  limit: number;
}) {
  const { ref, height } = useElementSize<HTMLDivElement>();
  // 2-column grid: provider row ~42px tall (24px icon + padding + border) + 6px gap.
  const visibleCount = height > 0
    ? Math.max(limit, Math.ceil((height - 32) / 48) * 2 + 4)
    : limit;
  return (
    <div
      ref={ref}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
    >
      <SectionHeader
        title={title}
        right={
          <Link href={viewAllHref} style={{ color: 'inherit', textDecoration: 'none' }}>
            View all →
          </Link>
        }
      />
      <div
        className="no-scrollbar scroll-fade-y"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 6,
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          alignContent: 'start',
        }}
      >
        {items.slice(0, visibleCount).map((provider) => {
          const rawLogo = provider.logoPath
            ? `https://image.tmdb.org/t/p/w185${provider.logoPath}`
            : null;
          const logoSrc = rawLogo ? toCachedImageSrc(rawLogo, 'tmdb') || rawLogo : null;
          return (
            <Link
              key={`${provider.type}-${provider.id}`}
              href={buildProviderHref(provider.id, provider.type)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                background: HPR.ink,
                border: `1px solid ${HPR.hairline}`,
                borderRadius: 6,
                textDecoration: 'none',
                color: HPR.fg,
              }}
            >
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 5,
                  background: mix(HPR.violet, 14),
                  flexShrink: 0,
                  backgroundImage: logoSrc ? `url(${logoSrc})` : undefined,
                  backgroundSize: 'contain',
                  backgroundPosition: 'center',
                  backgroundRepeat: 'no-repeat',
                }}
              />
              <span
                style={{
                  fontSize: 11,
                  color: HPR.fg,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {provider.name}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function StatusBlock({ title, message }: { title?: string; message: string }) {
  return (
    <div>
      {title && <SectionHeader title={title} />}
      <div style={{ fontSize: 11, color: HPR.fgSubtle, padding: '6px 0' }}>{message}</div>
    </div>
  );
}

const BUILTIN_MAP = new Map(BUILTIN_DISCOVER_SECTIONS.map((s) => [s.id, s] as const));

function resolveSection(sectionId: string, sections: DiscoverLayoutSection[] | undefined) {
  if (!sections) return null;
  return sections.find((s) => s.id === sectionId) ?? null;
}

export function DiscoverSectionWidget({
  sectionId,
  refreshInterval,
  editMode,
  narrow,
  colSpan,
  layoutVariant,
  instanceId,
}: DiscoverSectionWidgetProps) {
  const compact = narrow || (colSpan != null && colSpan <= 6);
  const safeInterval = Math.max(refreshInterval, CLIENT_CACHE_MS);
  const discoverLayout = useUIStore((s) => s.discoverLayout);
  const { setWidgetLayoutOverride } = useDashboardLayout();
  const useList = !!narrow || layoutVariant === 'list';
  const toggleNode = !narrow && instanceId ? (
    <ViewModeToggle
      value={useList ? 'list' : 'carousel'}
      onChange={(next) => setWidgetLayoutOverride(instanceId, next)}
    />
  ) : null;

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
    enabled: !editMode && needsSections,
    cacheKey: 'discover-sections',
  });

  const customFilters = isCustom ? layoutSection!.filters! : null;
  const customCacheKey = customFilters
    ? `discover-custom-${buildCustomQuery(customFilters)}`
    : undefined;

  const {
    data: customItems,
    loading: customLoading,
    error: customError,
  } = useWidgetData<DiscoverItem[]>({
    fetchFn: () => fetchCustomCached(customFilters!),
    refreshInterval: safeInterval,
    enabled: !editMode && isCustom,
    cacheKey: customCacheKey,
  });

  if (!layoutSection) {
    return editMode
      ? <StatusBlock title="Discover" message="Section was removed from Discover Layout" />
      : null;
  }

  const title = layoutSection.label;
  const viewAllHref =
    layoutSection.type === 'custom' && layoutSection.filters
      ? buildCustomDiscoverHref(layoutSection.filters)
      : `/discover?section=${layoutSection.id}`;

  if (isBuiltinMedia) {
    if (sectionsLoading && !sectionsData) return <StatusBlock title={title} message="Loading…" />;
    const section = sectionsData?.sections?.find((s): s is DiscoverSection => s.key === sectionId);
    const items = (section?.items as DiscoverItem[] | undefined) ?? [];
    if (sectionsError && items.length === 0) {
      return <StatusBlock title={title} message={sectionsError} />;
    }
    if (items.length === 0) {
      return editMode ? <StatusBlock title={title} message="No items found" /> : null;
    }
    return (
      <MediaCarouselView
        title={title}
        viewAllHref={viewAllHref}
        items={items}
        limit={compact ? 6 : 20}
        useList={useList}
        toggleNode={toggleNode}
      />
    );
  }

  if (isBuiltinGenre) {
    if (sectionsLoading && !sectionsData) return <StatusBlock title={title} message="Loading…" />;
    const section = sectionsData?.sections?.find((s): s is DiscoverSection => s.key === sectionId);
    const items = (section?.items as DiscoverGenre[] | undefined) ?? [];
    if (sectionsError && items.length === 0) {
      return <StatusBlock title={title} message={sectionsError} />;
    }
    if (items.length === 0) {
      return editMode ? <StatusBlock title={title} message="No genres found" /> : null;
    }
    return (
      <GenreGridView
        title={title}
        viewAllHref={viewAllHref}
        items={items}
        limit={compact ? 6 : 12}
      />
    );
  }

  if (isBuiltinProvider) {
    if (sectionsLoading && !sectionsData) return <StatusBlock title={title} message="Loading…" />;
    const section = sectionsData?.sections?.find((s): s is DiscoverSection => s.key === sectionId);
    const items = (section?.items as DiscoverProvider[] | undefined) ?? [];
    if (sectionsError && items.length === 0) {
      return <StatusBlock title={title} message={sectionsError} />;
    }
    if (items.length === 0) {
      return editMode ? <StatusBlock title={title} message="No providers found" /> : null;
    }
    return (
      <ProviderGridView
        title={title}
        viewAllHref={viewAllHref}
        items={items}
        limit={compact ? 4 : 8}
      />
    );
  }

  if (isCustom) {
    if (customLoading && !customItems) return <StatusBlock title={title} message="Loading…" />;
    const items = customItems ?? [];
    if (customError && items.length === 0) {
      return <StatusBlock title={title} message={customError} />;
    }
    if (items.length === 0) {
      return editMode ? <StatusBlock title={title} message="No items found" /> : null;
    }
    return (
      <MediaCarouselView
        title={title}
        viewAllHref={viewAllHref}
        items={items}
        limit={compact ? 6 : 20}
        useList={useList}
        toggleNode={toggleNode}
      />
    );
  }

  return editMode ? <StatusBlock title={title} message="Unsupported section" /> : null;
}
