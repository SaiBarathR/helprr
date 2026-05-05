'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { PageSpinner } from '@/components/ui/page-spinner';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MediaCard } from '@/components/media/media-card';
import { MediaOverviewItem } from '@/components/media/media-overview';
import { MediaTable } from '@/components/media/media-table';
import { ViewSelector } from '@/components/media/view-selector';
import { FieldToggles } from '@/components/media/field-toggles';
import { SearchBar } from '@/components/media/search-bar';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Filter, ArrowUpDown, Plus, RefreshCw } from 'lucide-react';
import { useUIStore } from '@/lib/store';
import {
  getCachedListData,
  getListViewState,
  isListDataFresh,
  setCachedListData,
  setListViewState,
} from '@/lib/media-list-cache';
import type { SonarrSeriesListItem } from '@/types';

import type { MediaViewMode } from '@/lib/store';

interface SeriesPageCacheData {
  series: SonarrSeriesListItem[];
  qualityProfiles: { id: number; name: string }[];
  tags: { id: number; label: string }[];
}

const FIELD_OPTIONS_BY_MODE: Record<MediaViewMode, { value: string; label: string }[]> = {
  posters: [
    { value: 'year', label: 'Year' },
    { value: 'rating', label: 'Rating' },
    { value: 'monitored', label: 'Monitored' },
  ],
  overview: [
    { value: 'qualityProfile', label: 'Quality Profile' },
    { value: 'rating', label: 'Rating' },
    { value: 'network', label: 'Network' },
    { value: 'sizeOnDisk', label: 'Size on Disk' },
    { value: 'runtime', label: 'Runtime' },
    { value: 'monitored', label: 'Monitored' },
    { value: 'year', label: 'Year' },
    { value: 'episodeProgress', label: 'Episode Progress' },
    { value: 'genres', label: 'Genres' },
    { value: 'overview', label: 'Overview' },
    { value: 'images', label: 'Poster' },
  ],
  table: [
    { value: 'monitored', label: 'Monitored' },
    { value: 'year', label: 'Year' },
    { value: 'qualityProfile', label: 'Quality Profile' },
    { value: 'network', label: 'Network' },
    { value: 'episodeProgress', label: 'Episode Progress' },
    { value: 'rating', label: 'Rating' },
    { value: 'sizeOnDisk', label: 'Size on Disk' },
  ],
};

const filterOptions = [
  { value: 'all', label: 'All' },
  { value: 'monitored', label: 'Monitored' },
  { value: 'unmonitored', label: 'Unmonitored' },
  { value: 'continuing', label: 'Continuing' },
  { value: 'ended', label: 'Ended' },
  { value: 'missing', label: 'Missing' },
  { value: 'upcoming', label: 'Upcoming' },
] as const;

const sortOptions = [
  { value: 'title', label: 'Title' },
  { value: 'year', label: 'Year' },
  { value: 'dateAdded', label: 'Added' },
  { value: 'rating', label: 'Rating' },
  { value: 'sizeOnDisk', label: 'Size on Disk' },
  { value: 'nextAiring', label: 'Next Airing' },
  { value: 'previousAiring', label: 'Previous Airing' },
  { value: 'network', label: 'Network' },
  { value: 'runtime', label: 'Runtime' },
  { value: 'qualityProfile', label: 'Quality Profile' },
  { value: 'monitored', label: 'Monitored/Status' },
  { value: 'originalLanguage', label: 'Original Language' },
  { value: 'seasons', label: 'Seasons' },
  { value: 'episodes', label: 'Episodes' },
  { value: 'episodeCount', label: 'Episode Count' },
  { value: 'path', label: 'Path' },
  { value: 'tags', label: 'Tags' },
] as const;

function getPosterColumns(width: number, posterSize: 'small' | 'medium' | 'large') {
  if (posterSize === 'small') {
    if (width >= 1280) return 8;
    if (width >= 1024) return 7;
    if (width >= 768) return 6;
    if (width >= 640) return 5;
    return 4;
  }

  if (posterSize === 'large') {
    if (width >= 1280) return 5;
    if (width >= 1024) return 4;
    if (width >= 768) return 3;
    return 2;
  }

  if (width >= 1280) return 6;
  if (width >= 1024) return 5;
  if (width >= 768) return 4;
  return 3;
}

/**
 * Render the Sonarr series management page with client-side search, filtering, sorting, view selection, and field visibility controls.
 *
 * Fetches series, quality profiles, and tags on mount, and provides posters, overview, and table presentations with responsive behavior and skeleton loading states.
 *
 * @returns The page's JSX element that displays and manages Sonarr series.
 */
export default function SeriesPage() {
  const [series, setSeries] = useState<SonarrSeriesListItem[]>([]);
  const [qualityProfiles, setQualityProfiles] = useState<{ id: number; name: string }[]>([]);
  const [tags, setTags] = useState<{ id: number; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(1280);
  const [containerWidth, setContainerWidth] = useState(0);
  const [contentOffsetTop, setContentOffsetTop] = useState(0);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const hasRestoredScrollRef = useRef(false);
  const hasRestoredSearchRef = useRef(false);

  const {
    seriesView: viewMode,
    setSeriesView: setViewMode,
    seriesPosterSize: posterSize,
    setSeriesPosterSize: setPosterSize,
    seriesSort: sort,
    setSeriesSort: setSort,
    seriesSortDirection: sortDir,
    setSeriesSortDirection: setSortDir,
    seriesFilter: filter,
    setSeriesFilter: setFilter,
    seriesVisibleFields: visibleFieldsByMode,
    setSeriesVisibleFields: setVisibleFieldsForMode,
    seriesSearch: search,
    setSeriesSearch: setSearch,
  } = useUIStore();

  const visibleFields = visibleFieldsByMode[viewMode];
  const setVisibleFields = useCallback(
    (fields: string[]) => setVisibleFieldsForMode(viewMode, fields),
    [viewMode, setVisibleFieldsForMode]
  );

  const persistViewState = useCallback((scrollY = window.scrollY, searchValue = search) => {
    setListViewState('series', { scrollY, search: searchValue });
  }, [search]);

  const fetchData = useCallback(async (force = false) => {
    const cached = force ? null : getCachedListData<SeriesPageCacheData>('series');
    const hasCachedData = Boolean(cached?.data);

    if (cached?.data) {
      setSeries(cached.data.series);
      setQualityProfiles(cached.data.qualityProfiles);
      setTags(cached.data.tags);
      setLoading(false);

      if (isListDataFresh(cached)) {
        setRefreshing(false);
        return;
      }

      setRefreshing(true);
    } else {
      setLoading(true);
      setRefreshing(false);
    }

    try {
      const [s, q, t] = await Promise.all([
        fetch('/api/sonarr').then((r) => r.ok ? r.json() : []),
        fetch('/api/sonarr/qualityprofiles').then((r) => r.ok ? r.json() : []),
        fetch('/api/sonarr/tags').then((r) => r.ok ? r.json() : []),
      ]);

      const next: SeriesPageCacheData = {
        series: s,
        qualityProfiles: q,
        tags: t,
      };

      setSeries(next.series);
      setQualityProfiles(next.qualityProfiles);
      setTags(next.tags);
      setCachedListData('series', next);
    } catch {
      if (!hasCachedData) {
        setSeries([]);
        setQualityProfiles([]);
        setTags([]);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData(false);
  }, [fetchData]);

  useEffect(() => {
    if (hasRestoredSearchRef.current) return;
    hasRestoredSearchRef.current = true;

    const saved = getListViewState('series');
    if (!saved) return;
    if (!search && saved.search) setSearch(saved.search);
  }, [search, setSearch]);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    const measure = () => {
      const rect = container.getBoundingClientRect();
      setContainerWidth(rect.width);
      setContentOffsetTop(rect.top + window.scrollY);
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(container);
    window.addEventListener('resize', measure);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [viewMode, posterSize, loading, series.length, search, filter]);

  useEffect(() => {
    if (loading || hasRestoredScrollRef.current) return;
    hasRestoredScrollRef.current = true;

    const saved = getListViewState('series');
    if (!saved || saved.scrollY <= 0) return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.scrollTo({ top: saved.scrollY, behavior: 'instant' });
      });
    });
  }, [loading]);

  useEffect(() => {
    persistViewState(window.scrollY, search);
  }, [search, persistViewState]);

  useEffect(() => {
    let lastSaved = 0;
    const onScroll = () => {
      const now = Date.now();
      if (now - lastSaved < 150) return;
      lastSaved = now;
      persistViewState(window.scrollY, search);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [persistViewState, search]);

  const handleSearch = useCallback((v: string) => setSearch(v), [setSearch]);
  const handleNavigateToDetail = useCallback(() => {
    persistViewState(window.scrollY, search);
  }, [persistViewState, search]);

  const qualityProfileMap = useMemo(
    () => new Map(qualityProfiles.map((profile) => [profile.id, profile.name])),
    [qualityProfiles]
  );
  const tagMap = useMemo(() => new Map(tags.map((tag) => [tag.id, tag.label])), [tags]);

  const filtered = useMemo(() => {
    let list = series;

    if (search) {
      const q = search.toLowerCase();
      list = list.filter((s) => s.title.toLowerCase().includes(q));
    }

    if (filter === 'monitored') list = list.filter((s) => s.monitored);
    else if (filter === 'unmonitored') list = list.filter((s) => !s.monitored);
    else if (filter === 'continuing') list = list.filter((s) => s.status === 'continuing');
    else if (filter === 'ended') list = list.filter((s) => s.status === 'ended');
    else if (filter === 'missing') list = list.filter((s) => s.monitored && s.statistics.episodeCount < s.statistics.totalEpisodeCount);
    else if (filter === 'upcoming') list = list.filter((s) => s.status === 'upcoming');

    list = [...list].sort((a, b) => {
      let result = 0;

      switch (sort) {
        case 'title':
          result = a.sortTitle.localeCompare(b.sortTitle);
          break;
        case 'year':
          result = a.year - b.year;
          break;
        case 'dateAdded':
          result = new Date(a.added).getTime() - new Date(b.added).getTime();
          break;
        case 'network':
          result = (a.network || '').localeCompare(b.network || '');
          break;
        case 'runtime':
          result = a.runtime - b.runtime;
          break;
        case 'rating':
          result = (a.ratings?.value || 0) - (b.ratings?.value || 0);
          break;
        case 'monitored':
          result = (a.monitored === b.monitored) ? 0 : a.monitored ? -1 : 1;
          break;
        case 'qualityProfile': {
          const qA = qualityProfileMap.get(a.qualityProfileId) || '';
          const qB = qualityProfileMap.get(b.qualityProfileId) || '';
          result = qA.localeCompare(qB);
          break;
        }
        case 'originalLanguage':
          result = (a.originalLanguage?.name || '').localeCompare(b.originalLanguage?.name || '');
          break;
        case 'nextAiring':
          result = new Date(a.nextAiring || '9999').getTime() - new Date(b.nextAiring || '9999').getTime();
          break;
        case 'previousAiring':
          result = new Date(a.previousAiring || 0).getTime() - new Date(b.previousAiring || 0).getTime();
          break;
        case 'seasons':
          result = a.statistics.seasonCount - b.statistics.seasonCount;
          break;
        case 'episodes':
          result = a.statistics.episodeCount - b.statistics.episodeCount;
          break;
        case 'episodeCount':
          result = a.statistics.totalEpisodeCount - b.statistics.totalEpisodeCount;
          break;
        case 'path':
          result = (a.path || '').localeCompare(b.path || '');
          break;
        case 'sizeOnDisk':
          result = a.statistics.sizeOnDisk - b.statistics.sizeOnDisk;
          break;
        case 'tags': {
          const tA = a.tags.map((id) => tagMap.get(id) || '').sort().join(',');
          const tB = b.tags.map((id) => tagMap.get(id) || '').sort().join(',');
          result = tA.localeCompare(tB);
          break;
        }
        default:
          result = 0;
      }

      return sortDir === 'asc' ? result : -result;
    });

    return list;
  }, [series, search, sort, sortDir, filter, qualityProfileMap, tagMap]);

  const isDesktop = viewportWidth >= 768;
  const effectiveView = viewMode === 'table' ? 'table' : viewMode;
  const useVirtualization = !loading && filtered.length > 0;

  const posterGridClass = posterSize === 'small'
    ? 'grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-2'
    : posterSize === 'large'
      ? 'grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3'
      : 'grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3';

  const posterColumns = getPosterColumns(viewportWidth, posterSize);
  const posterGap = posterSize === 'small' ? 8 : 12;
  const posterRowHeight = useMemo(() => {
    if (containerWidth <= 0) {
      if (posterSize === 'small') return 148;
      if (posterSize === 'large') return 264;
      return 216;
    }

    const cardWidth = Math.max(1, (containerWidth - posterGap * (posterColumns - 1)) / posterColumns);
    return cardWidth * 1.5 + posterGap;
  }, [containerWidth, posterColumns, posterGap, posterSize]);

  const posterRowCount = Math.ceil(filtered.length / posterColumns);
  const posterVirtualizer = useWindowVirtualizer({
    count: posterRowCount,
    estimateSize: () => posterRowHeight,
    enabled: useVirtualization && effectiveView === 'posters',
    overscan: 2,
    scrollMargin: contentOffsetTop,
  });

  const overviewRowHeight = useMemo(() => {
    let base = posterSize === 'small' ? 92 : posterSize === 'large' ? 168 : 124;
    if (visibleFields.includes('overview')) base += 24;
    if (!visibleFields.includes('images')) base -= 20;
    return base;
  }, [posterSize, visibleFields]);

  const overviewVirtualizer = useWindowVirtualizer({
    count: filtered.length,
    estimateSize: () => overviewRowHeight,
    enabled: useVirtualization && effectiveView === 'overview',
    overscan: 6,
    scrollMargin: contentOffsetTop,
  });

  const tableRows = filtered.map((s) => ({
    id: s.id,
    title: s.title,
    year: s.year,
    href: `/series/${s.id}`,
    monitored: s.monitored,
    status: s.status,
    images: s.images,
    qualityProfile: qualityProfileMap.get(s.qualityProfileId),
    network: s.network,
    rating: s.ratings?.value,
    sizeOnDisk: s.statistics.sizeOnDisk,
    episodeProgress: `${s.statistics.episodeCount}/${s.statistics.totalEpisodeCount}`,
    runtime: s.runtime,
    genres: s.genres,
  }));

  const tableVirtualizer = useWindowVirtualizer({
    count: tableRows.length,
    estimateSize: () => 44,
    enabled: useVirtualization && effectiveView === 'table' && isDesktop,
    overscan: 12,
    scrollMargin: contentOffsetTop,
  });

  const mobileOverviewFields = visibleFieldsByMode.overview;
  const tableMobileOverviewRowHeight = useMemo(() => {
    let base = posterSize === 'small' ? 92 : posterSize === 'large' ? 168 : 124;
    if (mobileOverviewFields.includes('overview')) base += 24;
    if (!mobileOverviewFields.includes('images')) base -= 20;
    return base;
  }, [mobileOverviewFields, posterSize]);

  const tableMobileVirtualizer = useWindowVirtualizer({
    count: filtered.length,
    estimateSize: () => tableMobileOverviewRowHeight,
    enabled: useVirtualization && effectiveView === 'table' && !isDesktop,
    overscan: 6,
    scrollMargin: contentOffsetTop,
  });

  const activeFilterLabel = filterOptions.find((o) => o.value === filter)?.label ?? 'All';
  const activeSortLabel = sortOptions.find((o) => o.value === sort)?.label ?? 'Title';

  const totalCount = series.length;
  const filteredCount = filtered.length;

  return (
    <div className="space-y-3 animate-content-in">
      <div className="sticky z-30 -mx-2 px-2 pt-1 pb-2.5 bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70 md:-mx-6 md:px-6 space-y-2.5" style={{ top: 'var(--header-height, 0px)' }}>
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px"
          style={{ background: 'var(--hairline)' }}
        />

        <div className="flex items-center gap-2 pt-1.5">
          <span className="marquee-dot" aria-hidden />
          <span className="tracked-caps text-[9.5px] text-[color:var(--amber)]/85">
            On the Slate · {totalCount} {totalCount === 1 ? 'series' : 'series'}
          </span>
          <span className="hairline flex-1" aria-hidden />
          {filter !== 'all' && (
            <span className="tracked-caps text-[9px] text-muted-foreground/70 font-mono tabular" style={{ letterSpacing: '0.22em' }}>
              {activeFilterLabel} · {filteredCount}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="press-feedback h-10 px-2.5 inline-flex items-center gap-1.5 border border-[color:var(--hairline)] bg-card/40 hover:bg-card/70 hover:border-[color:var(--amber-soft)] transition-colors"
                style={{ borderRadius: 'calc(var(--radius) - 2px)' }}
                aria-label={`Filter: ${activeFilterLabel}`}
              >
                <Filter className="h-3.5 w-3.5" />
                <span className="tracked-caps text-[9.5px] hidden sm:inline">{activeFilterLabel}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuLabel>Filter</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {filterOptions.map((opt) => (
                <DropdownMenuCheckboxItem
                  key={opt.value}
                  checked={filter === opt.value}
                  onCheckedChange={() => setFilter(opt.value)}
                >
                  {opt.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="press-feedback h-10 px-2.5 inline-flex items-center gap-1.5 border border-[color:var(--hairline)] bg-card/40 hover:bg-card/70 hover:border-[color:var(--amber-soft)] transition-colors"
                style={{ borderRadius: 'calc(var(--radius) - 2px)' }}
                aria-label={`Sort: ${activeSortLabel} ${sortDir === 'asc' ? 'Ascending' : 'Descending'}`}
              >
                <ArrowUpDown className="h-3.5 w-3.5" />
                <span className="tracked-caps text-[9.5px] hidden sm:inline">{activeSortLabel}</span>
                <span className="hidden sm:inline text-[10px] text-[color:var(--amber)]">{sortDir === 'asc' ? '↑' : '↓'}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              <DropdownMenuLabel>Sort By</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {sortOptions.map((opt) => (
                <DropdownMenuCheckboxItem
                  key={opt.value}
                  checked={sort === opt.value}
                  onCheckedChange={() => setSort(opt.value)}
                >
                  {opt.label}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={sortDir === 'asc'}
                onCheckedChange={() => setSortDir('asc')}
              >
                Ascending
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={sortDir === 'desc'}
                onCheckedChange={() => setSortDir('desc')}
              >
                Descending
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <ViewSelector value={viewMode} onChange={setViewMode} />
          <FieldToggles
            available={FIELD_OPTIONS_BY_MODE[viewMode]}
            selected={visibleFields}
            onChange={setVisibleFields}
            posterSize={viewMode !== 'table' ? posterSize : undefined}
            onPosterSizeChange={viewMode !== 'table' ? setPosterSize : undefined}
          />

          <div className="flex-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => fetchData(true)}
                disabled={refreshing}
                className="press-feedback h-10 w-10 flex items-center justify-center border border-[color:var(--hairline)] bg-card/40 hover:bg-card/70 hover:border-[color:var(--amber-soft)] transition-colors"
                style={{ borderRadius: 'calc(var(--radius) - 2px)' }}
                aria-label="Refresh Series"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin text-[color:var(--amber)]' : ''}`} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Refresh Series</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/series/add"
                className="press-feedback projector-glow cta-sheen h-10 px-3.5 inline-flex items-center gap-1.5 bg-[color:var(--amber)] text-[color:var(--primary-foreground)] hover:translate-y-[-1px] transition-transform"
                style={{ borderRadius: 'calc(var(--radius) - 2px)' }}
                aria-label="Add Series"
              >
                <Plus className="h-4 w-4" />
                <span className="tracked-caps text-[10px] hidden sm:inline">Add</span>
              </Link>
            </TooltipTrigger>
            <TooltipContent>Add Series</TooltipContent>
          </Tooltip>
        </div>

        <SearchBar value={search} onChange={handleSearch} placeholder="Search the slate — by title…" />
      </div>

      {(() => {
        if (loading) {
          return <PageSpinner />;
        }

        if (filtered.length === 0) {
          return (
            <div
              className="mt-6 p-10 border border-[color:var(--hairline)] bg-card/40 text-center space-y-3"
              style={{ borderRadius: 'calc(var(--radius) - 1px)' }}
            >
              <div className="mx-auto h-10 w-10 rounded-full border border-[color:var(--hairline)] flex items-center justify-center">
                <Filter className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className="tracked-caps text-[10px] text-muted-foreground">
                {series.length === 0 ? 'No series catalogued' : 'Empty slate'}
              </p>
              <p className="font-display text-[18px]">
                {series.length === 0 ? 'The slate is empty.' : 'Nothing matches.'}
              </p>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                {series.length === 0
                  ? 'Connect your Sonarr server in Settings to populate the slate.'
                  : 'Try clearing filters or adjusting the search.'}
              </p>
            </div>
          );
        }

        if (effectiveView === 'posters') {
          const virtualRows = posterVirtualizer.getVirtualItems();
          const firstRow = virtualRows[0];
          const lastRow = virtualRows[virtualRows.length - 1];
          const startIndex = (firstRow?.index ?? 0) * posterColumns;
          const endIndex = Math.min(filtered.length, ((lastRow?.index ?? 0) + 1) * posterColumns);
          const visibleSeries = filtered.slice(startIndex, endIndex);
          const topSpacerHeight = firstRow ? Math.max(0, firstRow.start - contentOffsetTop) : 0;
          const bottomSpacerHeight = lastRow
            ? Math.max(0, posterVirtualizer.getTotalSize() - (lastRow.end - contentOffsetTop))
            : 0;

          return (
            <div ref={contentRef}>
              {topSpacerHeight > 0 && <div style={{ height: topSpacerHeight }} />}
              <div className={posterGridClass}>
                {visibleSeries.map((s) => (
                  <MediaCard
                    key={s.id}
                    title={s.title}
                    year={s.year}
                    images={s.images}
                    status={s.status}
                    monitored={s.monitored}
                    type="series"
                    href={`/series/${s.id}`}
                    visibleFields={visibleFields}
                    rating={s.ratings?.value}
                    onNavigate={handleNavigateToDetail}
                  />
                ))}
              </div>
              {bottomSpacerHeight > 0 && <div style={{ height: bottomSpacerHeight }} />}
            </div>
          );
        }

        if (effectiveView === 'overview') {
          const virtualRows = overviewVirtualizer.getVirtualItems();
          const firstRow = virtualRows[0];
          const lastRow = virtualRows[virtualRows.length - 1];
          const startIndex = firstRow?.index ?? 0;
          const endIndex = (lastRow?.index ?? 0) + 1;
          const visibleSeries = filtered.slice(startIndex, endIndex);
          const topSpacerHeight = firstRow ? Math.max(0, firstRow.start - contentOffsetTop) : 0;
          const bottomSpacerHeight = lastRow
            ? Math.max(0, overviewVirtualizer.getTotalSize() - (lastRow.end - contentOffsetTop))
            : 0;

          return (
            <div ref={contentRef} className="space-y-2">
              {topSpacerHeight > 0 && <div style={{ height: topSpacerHeight }} />}
              {visibleSeries.map((s) => (
                <MediaOverviewItem
                  key={s.id}
                  title={s.title}
                  year={s.year}
                  images={s.images}
                  href={`/series/${s.id}`}
                  type="series"
                  monitored={s.monitored}
                  status={s.status}
                  visibleFields={visibleFields}
                  posterSize={posterSize}
                  qualityProfile={qualityProfileMap.get(s.qualityProfileId)}
                  network={s.network}
                  overview={s.overview}
                  rating={s.ratings?.value}
                  sizeOnDisk={s.statistics.sizeOnDisk}
                  runtime={s.runtime}
                  episodeProgress={`${s.statistics.episodeCount}/${s.statistics.totalEpisodeCount}`}
                  genres={s.genres}
                  onNavigate={handleNavigateToDetail}
                />
              ))}
              {bottomSpacerHeight > 0 && <div style={{ height: bottomSpacerHeight }} />}
            </div>
          );
        }

        if (isDesktop) {
          const virtualRows = tableVirtualizer.getVirtualItems();
          const firstRow = virtualRows[0];
          const lastRow = virtualRows[virtualRows.length - 1];
          const startIndex = firstRow?.index ?? 0;
          const endIndex = (lastRow?.index ?? 0) + 1;
          const visibleRows = tableRows.slice(startIndex, endIndex);
          const topSpacerHeight = firstRow ? Math.max(0, firstRow.start - contentOffsetTop) : 0;
          const bottomSpacerHeight = lastRow
            ? Math.max(0, tableVirtualizer.getTotalSize() - (lastRow.end - contentOffsetTop))
            : 0;
          return (
            <div ref={contentRef}>
              <MediaTable
                type="series"
                visibleFields={visibleFields}
                rows={visibleRows}
                topSpacerHeight={topSpacerHeight}
                bottomSpacerHeight={bottomSpacerHeight}
                onNavigate={handleNavigateToDetail}
              />
            </div>
          );
        }

        const virtualRows = tableMobileVirtualizer.getVirtualItems();
        const firstRow = virtualRows[0];
        const lastRow = virtualRows[virtualRows.length - 1];
        const startIndex = firstRow?.index ?? 0;
        const endIndex = (lastRow?.index ?? 0) + 1;
        const visibleSeries = filtered.slice(startIndex, endIndex);
        const topSpacerHeight = firstRow ? Math.max(0, firstRow.start - contentOffsetTop) : 0;
        const bottomSpacerHeight = lastRow
          ? Math.max(0, tableMobileVirtualizer.getTotalSize() - (lastRow.end - contentOffsetTop))
          : 0;

        return (
          <div ref={contentRef} className="space-y-2">
            {topSpacerHeight > 0 && <div style={{ height: topSpacerHeight }} />}
            {visibleSeries.map((s) => (
              <MediaOverviewItem
                key={s.id}
                title={s.title}
                year={s.year}
                images={s.images}
                href={`/series/${s.id}`}
                type="series"
                monitored={s.monitored}
                status={s.status}
                visibleFields={mobileOverviewFields}
                posterSize={posterSize}
                qualityProfile={qualityProfileMap.get(s.qualityProfileId)}
                network={s.network}
                overview={s.overview}
                rating={s.ratings?.value}
                sizeOnDisk={s.statistics.sizeOnDisk}
                runtime={s.runtime}
                episodeProgress={`${s.statistics.episodeCount}/${s.statistics.totalEpisodeCount}`}
                genres={s.genres}
                onNavigate={handleNavigateToDetail}
              />
            ))}
            {bottomSpacerHeight > 0 && <div style={{ height: bottomSpacerHeight }} />}
          </div>
        );
      })()}
    </div>
  );
}
