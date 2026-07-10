'use client';

import Link from 'next/link';
import { useCallback, useMemo } from 'react';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { useElementSize } from '@/lib/widgets/use-element-size';
import { useListFetchSize } from '@/lib/widgets/use-list-fetch-size';
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
  mobileGrid?: boolean;
}

const CLIENT_CACHE_MS = 5 * 60 * 1000;

// Cache the sections fetch per perSectionLimit. Widgets at the same size
// share a single in-flight request via this map; differently-sized widgets
// each get the bundle they need without colliding.
const sectionsPromises = new Map<number, { promise: Promise<DiscoverResponse>; time: number }>();

function fetchSectionsCached(perSectionLimit: number): Promise<DiscoverResponse> {
  const now = Date.now();
  const existing = sectionsPromises.get(perSectionLimit);
  if (existing && now - existing.time < CLIENT_CACHE_MS) return existing.promise;
  const promise = fetch(`/api/discover?mode=sections&perSectionLimit=${perSectionLimit}`)
    .then((res) => {
      if (!res.ok) throw new Error('Failed to fetch Discover sections');
      return res.json() as Promise<DiscoverResponse>;
    })
    .catch((err) => {
      sectionsPromises.delete(perSectionLimit);
      throw err;
    });
  sectionsPromises.set(perSectionLimit, { promise, time: now });
  return promise;
}

interface CustomCache {
  promise: Promise<DiscoverItem[]>;
  time: number;
}

// LRU-evicted cache for custom Discover carousel queries. Insertion order ==
// recency order in JS Maps; we delete-then-set on every hit so the
// most-recently-accessed entry stays at the end and `keys().next()` returns the
// oldest for eviction. Caps long-running tabs that explore many filter combos.
const CUSTOM_CACHE_MAX_ENTRIES = 50;
const customCache = new Map<string, CustomCache>();

function customCacheSet(query: string, entry: CustomCache): void {
  customCache.delete(query);
  customCache.set(query, entry);
  while (customCache.size > CUSTOM_CACHE_MAX_ENTRIES) {
    const oldest = customCache.keys().next().value;
    if (oldest === undefined) break;
    customCache.delete(oldest);
  }
}

function buildCustomQuery(filters: DiscoverLayoutCustomFilters, limit?: number): string {
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
  if (limit) params.set('limit', String(limit));
  return params.toString();
}

function fetchCustomCached(filters: DiscoverLayoutCustomFilters, limit: number): Promise<DiscoverItem[]> {
  const query = buildCustomQuery(filters, limit);
  const now = Date.now();
  const cached = customCache.get(query);
  if (cached && now - cached.time < CLIENT_CACHE_MS) {
    // Bump recency without re-fetching.
    customCacheSet(query, cached);
    return cached.promise;
  }
  const promise = fetch(`/api/discover?${query}`)
    .then((res) => {
      if (!res.ok) throw new Error('Failed to fetch Discover carousel');
      return res.json() as Promise<DiscoverResponse>;
    })
    .then((data) => (data.items ?? []).slice(0, limit))
    .catch((err) => {
      customCache.delete(query);
      throw err;
    });
  customCacheSet(query, { promise, time: now });
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
  const { visibleCount: listVisible } = useListFetchSize({
    height,
    rowHeight: LIST_ROW_HEIGHT,
  });
  const dynamicLimit = useList
    ? Math.max(limit, listVisible)
    : width > 0
      ? Math.max(limit, Math.ceil(width / (CAROUSEL_CARD_WIDTH + CAROUSEL_GAP)) + 4)
      : limit;
  const headerRight = (
    <>
      {toggleNode}
      <Link href={viewAllHref} style={{ color: 'inherit', textDecoration: 'none' }}>
        <span className="@max-[219px]/cell:hidden">View all </span>→
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
                        fontWeight: 500,
                      }}
                      className='line-clamp-2'
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
                      color: 'var(--hpr-fg)',
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
                  fontWeight: 500,
                }}
                className='line-clamp-2'
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
            <span className="@max-[219px]/cell:hidden">View all </span>→
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
            <span className="@max-[219px]/cell:hidden">View all </span>→
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
  mobileGrid = false,
}: DiscoverSectionWidgetProps) {
  const compact = narrow || (colSpan != null && colSpan <= 6);
  const discoverLayout = useUIStore((s) => s.discoverLayout);
  const { setWidgetLayoutOverride } = useDashboardLayout();
  const useList = !!narrow || layoutVariant === 'list';
  const toggleNode = !narrow && instanceId ? (
    <ViewModeToggle
      value={useList ? 'list' : 'carousel'}
      onChange={(next) => setWidgetLayoutOverride(instanceId, next, { mobile: mobileGrid })}
    />
  ) : null;
  // Height/width-aware fetch sizing: when the widget grows taller (list mode)
  // or wider (carousel mode), ask the discover API for more items. Custom
  // carousels use limit (clamped to 60, multi-page browse). Builtin sections
  // use perSectionLimit (clamped to 40 = 2 TMDB pages per section).
  const { ref: sizeRef, width: widgetWidth, height: widgetHeight } = useElementSize<HTMLDivElement>();
  const { fetchSize: heightFetchSize } = useListFetchSize({
    height: widgetHeight,
    rowHeight: LIST_ROW_HEIGHT,
  });
  const carouselVisible = widgetWidth > 0
    ? Math.ceil(widgetWidth / (CAROUSEL_CARD_WIDTH + CAROUSEL_GAP)) + 4
    : 12;
  const widthFetchSize = Math.ceil(carouselVisible / 20) * 20;
  const combinedFetchSize = Math.max(heightFetchSize, widthFetchSize);
  const effectiveCustomLimit = Math.min(60, Math.max(20, combinedFetchSize));
  const effectiveSectionLimit = Math.min(40, Math.max(20, combinedFetchSize));

  const layoutSection = useMemo(
    () => resolveSection(sectionId, discoverLayout?.sections),
    [sectionId, discoverLayout],
  );

  const isBuiltinMedia = layoutSection?.type === 'builtin' && BUILTIN_MAP.get(sectionId)?.sectionType === 'media';
  const isBuiltinGenre = layoutSection?.type === 'builtin' && BUILTIN_MAP.get(sectionId)?.sectionType === 'genre';
  const isBuiltinProvider = layoutSection?.type === 'builtin' && BUILTIN_MAP.get(sectionId)?.sectionType === 'provider';
  const isCustom = layoutSection?.type === 'custom' && Boolean(layoutSection.filters);

  const needsSections = isBuiltinMedia || isBuiltinGenre || isBuiltinProvider;

  const fetchSections = useCallback(
    () => fetchSectionsCached(effectiveSectionLimit),
    [effectiveSectionLimit],
  );
  const {
    data: sectionsData,
    loading: sectionsLoading,
    error: sectionsError,
  } = useWidgetData<DiscoverResponse>({
    fetchFn: fetchSections,
    refreshInterval,
    enabled: !editMode && needsSections,
    cacheKey: `discover-sections-${effectiveSectionLimit}`,
  });

  const customFilters = isCustom ? layoutSection!.filters! : null;
  const customCacheKey = customFilters
    ? `discover-custom-${buildCustomQuery(customFilters, effectiveCustomLimit)}`
    : undefined;
  const fetchCustom = useCallback(
    () => fetchCustomCached(customFilters!, effectiveCustomLimit),
    [customFilters, effectiveCustomLimit],
  );

  const {
    data: customItems,
    loading: customLoading,
    error: customError,
  } = useWidgetData<DiscoverItem[]>({
    fetchFn: fetchCustom,
    refreshInterval,
    enabled: !editMode && isCustom,
    cacheKey: customCacheKey,
  });

  const wrap = (content: React.ReactNode) => (
    <div
      ref={sizeRef}
      style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}
    >
      {content}
    </div>
  );

  if (!layoutSection) {
    return editMode
      ? wrap(<StatusBlock title="Discover" message="Section was removed from Discover Layout" />)
      : null;
  }

  const title = layoutSection.label;
  const viewAllHref =
    layoutSection.type === 'custom' && layoutSection.filters
      ? buildCustomDiscoverHref(layoutSection.filters)
      : `/discover?section=${layoutSection.id}`;

  if (isBuiltinMedia) {
    if (sectionsLoading && !sectionsData) return wrap(<StatusBlock title={title} message="Loading…" />);
    const section = sectionsData?.sections?.find((s): s is DiscoverSection => s.key === sectionId);
    const items = (section?.items as DiscoverItem[] | undefined) ?? [];
    if (sectionsError && items.length === 0) {
      return wrap(<StatusBlock title={title} message={sectionsError} />);
    }
    if (items.length === 0) {
      return editMode ? wrap(<StatusBlock title={title} message="No items found" />) : null;
    }
    return wrap(
      <MediaCarouselView
        title={title}
        viewAllHref={viewAllHref}
        items={items}
        limit={compact ? 16 : 20}
        useList={useList}
        toggleNode={toggleNode}
      />,
    );
  }

  if (isBuiltinGenre) {
    if (sectionsLoading && !sectionsData) return wrap(<StatusBlock title={title} message="Loading…" />);
    const section = sectionsData?.sections?.find((s): s is DiscoverSection => s.key === sectionId);
    const items = (section?.items as DiscoverGenre[] | undefined) ?? [];
    if (sectionsError && items.length === 0) {
      return wrap(<StatusBlock title={title} message={sectionsError} />);
    }
    if (items.length === 0) {
      return editMode ? wrap(<StatusBlock title={title} message="No genres found" />) : null;
    }
    return wrap(
      <GenreGridView
        title={title}
        viewAllHref={viewAllHref}
        items={items}
        limit={compact ? 6 : 12}
      />,
    );
  }

  if (isBuiltinProvider) {
    if (sectionsLoading && !sectionsData) return wrap(<StatusBlock title={title} message="Loading…" />);
    const section = sectionsData?.sections?.find((s): s is DiscoverSection => s.key === sectionId);
    const items = (section?.items as DiscoverProvider[] | undefined) ?? [];
    if (sectionsError && items.length === 0) {
      return wrap(<StatusBlock title={title} message={sectionsError} />);
    }
    if (items.length === 0) {
      return editMode ? wrap(<StatusBlock title={title} message="No providers found" />) : null;
    }
    return wrap(
      <ProviderGridView
        title={title}
        viewAllHref={viewAllHref}
        items={items}
        limit={compact ? 4 : 8}
      />,
    );
  }

  if (isCustom) {
    if (customLoading && !customItems) return wrap(<StatusBlock title={title} message="Loading…" />);
    const items = customItems ?? [];
    if (customError && items.length === 0) {
      return wrap(<StatusBlock title={title} message={customError} />);
    }
    if (items.length === 0) {
      return editMode ? wrap(<StatusBlock title={title} message="No items found" />) : null;
    }
    return wrap(
      <MediaCarouselView
        title={title}
        viewAllHref={viewAllHref}
        items={items}
        limit={compact ? 16 : 20}
        useList={useList}
        toggleNode={toggleNode}
      />,
    );
  }

  return editMode ? wrap(<StatusBlock title={title} message="Unsupported section" />) : null;
}
