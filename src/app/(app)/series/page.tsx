'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
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
import { useWindowVirtualRange } from '@/hooks/use-window-virtual-range';
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

    const measure = () => setContainerWidth(container.getBoundingClientRect().width);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(container);

    return () => observer.disconnect();
  }, [viewMode, posterSize]);

  useEffect(() => {
    if (loading || hasRestoredScrollRef.current) return;
    hasRestoredScrollRef.current = true;

    const saved = getListViewState('series');
    if (!saved || saved.scrollY <= 0) return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.scrollTo({ top: saved.scrollY, behavior: 'auto' });
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
  const useVirtualization = filtered.length > 120 && !loading;

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
  const posterVirtual = useWindowVirtualRange({
    container: contentRef.current,
    itemCount: posterRowCount,
    itemSize: posterRowHeight,
    enabled: useVirtualization && effectiveView === 'posters',
    overscan: 2,
  });

  const overviewRowHeight = useMemo(() => {
    let base = posterSize === 'small' ? 92 : posterSize === 'large' ? 168 : 124;
    if (visibleFields.includes('overview')) base += 24;
    if (!visibleFields.includes('images')) base -= 20;
    return base;
  }, [posterSize, visibleFields]);

  const overviewVirtual = useWindowVirtualRange({
    container: contentRef.current,
    itemCount: filtered.length,
    itemSize: overviewRowHeight,
    enabled: useVirtualization && effectiveView === 'overview',
    overscan: 6,
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

  const tableVirtual = useWindowVirtualRange({
    container: contentRef.current,
    itemCount: tableRows.length,
    itemSize: 44,
    enabled: useVirtualization && effectiveView === 'table' && isDesktop,
    overscan: 12,
  });

  const mobileOverviewFields = visibleFieldsByMode.overview;
  const tableMobileOverviewRowHeight = useMemo(() => {
    let base = posterSize === 'small' ? 92 : posterSize === 'large' ? 168 : 124;
    if (mobileOverviewFields.includes('overview')) base += 24;
    if (!mobileOverviewFields.includes('images')) base -= 20;
    return base;
  }, [mobileOverviewFields, posterSize]);

  const tableMobileVirtual = useWindowVirtualRange({
    container: contentRef.current,
    itemCount: filtered.length,
    itemSize: tableMobileOverviewRowHeight,
    enabled: useVirtualization && effectiveView === 'table' && !isDesktop,
    overscan: 6,
  });

  const activeFilterLabel = filterOptions.find((o) => o.value === filter)?.label ?? 'All';
  const activeSortLabel = sortOptions.find((o) => o.value === sort)?.label ?? 'Title';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors"
              aria-label={`Filter: ${activeFilterLabel}`}
            >
              <Filter className="h-5 w-5" />
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
              className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors"
              aria-label={`Sort: ${activeSortLabel} ${sortDir === 'asc' ? 'Ascending' : 'Descending'}`}
            >
              <ArrowUpDown className="h-5 w-5" />
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
              className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors"
              aria-label="Refresh Series"
            >
              <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Refresh Series</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href="/series/add"
              className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors"
              aria-label="Add Series"
            >
              <Plus className="h-5 w-5" />
            </Link>
          </TooltipTrigger>
          <TooltipContent>Add Series</TooltipContent>
        </Tooltip>
      </div>

      <SearchBar value={search} onChange={handleSearch} placeholder="Search series..." />

      {(() => {
        if (loading) {
          return effectiveView === 'posters' ? (
            <div className={posterGridClass}>
              {[...Array(12)].map((_, i) => (
                <Skeleton key={i} className="aspect-[2/3] rounded-xl" />
              ))}
            </div>
          ) : effectiveView === 'overview' ? (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
          ) : isDesktop ? (
            <div className="block"><Skeleton className="h-96 rounded-xl" /></div>
          ) : (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
          );
        }

        if (filtered.length === 0) {
          return (
            <div className="text-center py-12 text-muted-foreground">
              {series.length === 0
                ? 'No series found. Add your Sonarr connection in Settings.'
                : 'No series match your filters.'}
            </div>
          );
        }

        if (effectiveView === 'posters') {
          const startIndex = posterVirtual.startIndex * posterColumns;
          const endIndex = Math.min(filtered.length, posterVirtual.endIndex * posterColumns);
          const visibleSeries = filtered.slice(startIndex, endIndex);

          return (
            <div ref={contentRef}>
              {posterVirtual.topSpacerHeight > 0 && <div style={{ height: posterVirtual.topSpacerHeight }} />}
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
              {posterVirtual.bottomSpacerHeight > 0 && <div style={{ height: posterVirtual.bottomSpacerHeight }} />}
            </div>
          );
        }

        if (effectiveView === 'overview') {
          const visibleSeries = filtered.slice(overviewVirtual.startIndex, overviewVirtual.endIndex);

          return (
            <div ref={contentRef} className="space-y-2">
              {overviewVirtual.topSpacerHeight > 0 && <div style={{ height: overviewVirtual.topSpacerHeight }} />}
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
              {overviewVirtual.bottomSpacerHeight > 0 && <div style={{ height: overviewVirtual.bottomSpacerHeight }} />}
            </div>
          );
        }

        if (isDesktop) {
          const visibleRows = tableRows.slice(tableVirtual.startIndex, tableVirtual.endIndex);
          return (
            <div ref={contentRef}>
              <MediaTable
                type="series"
                visibleFields={visibleFields}
                rows={visibleRows}
                topSpacerHeight={tableVirtual.topSpacerHeight}
                bottomSpacerHeight={tableVirtual.bottomSpacerHeight}
                onNavigate={handleNavigateToDetail}
              />
            </div>
          );
        }

        const visibleSeries = filtered.slice(tableMobileVirtual.startIndex, tableMobileVirtual.endIndex);

        return (
          <div ref={contentRef} className="space-y-2">
            {tableMobileVirtual.topSpacerHeight > 0 && <div style={{ height: tableMobileVirtual.topSpacerHeight }} />}
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
            {tableMobileVirtual.bottomSpacerHeight > 0 && <div style={{ height: tableMobileVirtual.bottomSpacerHeight }} />}
          </div>
        );
      })()}
    </div>
  );
}
