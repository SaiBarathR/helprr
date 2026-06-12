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
import { Filter, ArrowUpDown, Plus, RefreshCw, ListChecks } from 'lucide-react';
import { toast } from 'sonner';
import { useCan } from '@/components/permission-provider';
import { useUIStore } from '@/lib/store';
import { useBulkSelection } from '@/lib/use-bulk-selection';
import { BulkActionBar } from '@/components/media/bulk-action-bar';
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

// Toast summary shared by every bulk action ("series" is invariant in the plural).
function reportBulk(verb: string, ok: number, fail: number) {
  if (fail) toast.error(`${verb} ${ok} series, ${fail} failed`);
  else toast.success(`${verb} ${ok} series`);
}

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
  // Members can't add directly to Sonarr — they request via Seerr from a detail page.
  const canAddSeries = useCan('series.add');
  const canMonitor = useCan('series.editMonitoring');
  const canTag = useCan('series.editTags');
  const canDelete = useCan('series.delete');
  const canSearch = useCan('activity.manage');
  const canBulk = canMonitor || canTag || canDelete || canSearch;
  const {
    selectionMode, selectedKeys, count: selectedCount,
    toggle, selectMany, deselectMany, enter, exit,
  } = useBulkSelection();
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
    seriesInstanceFilter: instanceFilter,
    setSeriesInstanceFilter: setInstanceFilter,
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

      // A misconfigured instance can answer 200 with a non-array body (e.g. an
      // arr web-UI page when its URL/key is wrong); never let that white-screen
      // the library — fall back to empty for any non-array.
      const next: SeriesPageCacheData = {
        series: Array.isArray(s) ? s : [],
        qualityProfiles: Array.isArray(q) ? q : [],
        tags: Array.isArray(t) ? t : [],
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

  // Connected instances derived from the (already instance-tagged) list. The
  // badge/filter only appear when more than one instance of the type exists.
  const instances = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of series) if (s.instanceId) m.set(s.instanceId, s.instanceLabel ?? s.instanceId);
    return [...m].map(([id, label]) => ({ id, label }));
  }, [series]);
  const multiInstance = instances.length > 1;
  const hrefForSeries = useCallback(
    (s: SonarrSeriesListItem) => (s.instanceId ? `/series/${s.id}?instance=${s.instanceId}` : `/series/${s.id}`),
    []
  );

  // Selection keys are composite so ids that repeat across instances stay distinct.
  const keyOf = useCallback((s: SonarrSeriesListItem) => `${s.instanceId ?? ''}:${s.id}`, []);
  const seriesByKey = useMemo(() => {
    const map = new Map<string, SonarrSeriesListItem>();
    for (const s of series) map.set(keyOf(s), s);
    return map;
  }, [series, keyOf]);

  // Drop a stale instance filter if that instance is no longer connected.
  useEffect(() => {
    if (instanceFilter !== 'all' && !instances.some((i) => i.id === instanceFilter)) {
      setInstanceFilter('all');
    }
  }, [instances, instanceFilter, setInstanceFilter]);

  const filtered = useMemo(() => {
    let list = series;

    if (search) {
      const q = search.toLowerCase();
      list = list.filter((s) => s.title.toLowerCase().includes(q));
    }

    if (filter.length > 0) {
      list = list.filter((s) => filter.some((f) => {
        if (f === 'monitored') return s.monitored;
        if (f === 'unmonitored') return !s.monitored;
        if (f === 'continuing') return s.status === 'continuing';
        if (f === 'ended') return s.status === 'ended';
        if (f === 'missing') return s.monitored && s.statistics.episodeCount < s.statistics.totalEpisodeCount;
        if (f === 'upcoming') return s.status === 'upcoming';
        return true;
      }));
    }

    if (instanceFilter !== 'all') {
      list = list.filter((s) => s.instanceId === instanceFilter);
    }

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
  }, [series, search, sort, sortDir, filter, instanceFilter, qualityProfileMap, tagMap]);

  // ── Bulk selection ────────────────────────────────────────────────────────
  const allFilteredSelected = filtered.length > 0 && filtered.every((s) => selectedKeys.has(keyOf(s)));
  const toggleSelectAll = useCallback(() => {
    // Deselect only the filtered keys (not clear()) so any selection made under a
    // different filter is preserved — the mirror of selectMany(filtered) above.
    if (allFilteredSelected) deselectMany(filtered.map(keyOf));
    else selectMany(filtered.map(keyOf));
  }, [allFilteredSelected, deselectMany, selectMany, filtered, keyOf]);

  // Selected series grouped by instance so each bulk request hits the right one.
  const groupSelectedByInstance = useCallback(() => {
    const groups = new Map<string | undefined, number[]>();
    for (const key of selectedKeys) {
      const s = seriesByKey.get(key);
      if (!s) continue;
      const list = groups.get(s.instanceId) ?? [];
      list.push(s.id);
      groups.set(s.instanceId, list);
    }
    return groups;
  }, [selectedKeys, seriesByKey]);

  const fanOut = useCallback(async (
    run: (instanceId: string | undefined, ids: number[]) => Promise<Response>
  ) => {
    let ok = 0;
    let fail = 0;
    await Promise.all([...groupSelectedByInstance()].map(async ([instanceId, ids]) => {
      try {
        const res = await run(instanceId, ids);
        if (res.ok) ok += ids.length;
        else fail += ids.length;
      } catch {
        fail += ids.length;
      }
    }));
    return { ok, fail };
  }, [groupSelectedByInstance]);

  const handleMonitor = useCallback(async (monitored: boolean) => {
    const { ok, fail } = await fanOut((instanceId, ids) =>
      fetch(`/api/sonarr/editor${instanceId ? `?instanceId=${encodeURIComponent(instanceId)}` : ''}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, monitored }),
      }));
    reportBulk(monitored ? 'Monitoring' : 'Unmonitoring', ok, fail);
    await fetchData(true);
    exit();
  }, [fanOut, fetchData, exit]);

  const handleApplyTags = useCallback(async (labels: string[], mode: 'add' | 'remove') => {
    const { ok, fail } = await fanOut((instanceId, ids) =>
      fetch(`/api/sonarr/editor${instanceId ? `?instanceId=${encodeURIComponent(instanceId)}` : ''}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, tags: labels, applyTags: mode }),
      }));
    reportBulk(mode === 'add' ? 'Tagged' : 'Untagged', ok, fail);
    await fetchData(true);
    exit();
  }, [fanOut, fetchData, exit]);

  const handleBulkSearch = useCallback(async () => {
    const { ok, fail } = await fanOut((instanceId, ids) =>
      fetch(`/api/sonarr/command${instanceId ? `?instanceId=${encodeURIComponent(instanceId)}` : ''}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'SeriesSearch', seriesIds: ids }),
      }));
    reportBulk('Searching', ok, fail);
    exit();
  }, [fanOut, exit]);

  const handleDelete = useCallback(async (deleteFiles: boolean) => {
    const { ok, fail } = await fanOut((instanceId, ids) =>
      fetch(`/api/sonarr/editor${instanceId ? `?instanceId=${encodeURIComponent(instanceId)}` : ''}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, deleteFiles }),
      }));
    reportBulk('Deleted', ok, fail);
    await fetchData(true);
    exit();
  }, [fanOut, fetchData, exit]);

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
    href: hrefForSeries(s),
    instanceId: s.instanceId,
    instanceLabel: multiInstance ? s.instanceLabel : undefined,
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

  const activeFilterLabel = filter.length === 0
    ? 'All'
    : filter.length === 1
      ? filterOptions.find((o) => o.value === filter[0])?.label ?? filter[0]
      : `${filter.length} filters`;
  const activeSortLabel = sortOptions.find((o) => o.value === sort)?.label ?? 'Title';

  return (
    <div className="space-y-3 animate-content-in">
      <div className="sticky z-30 -mx-2 px-2 pt-1 pb-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-6 md:px-6 space-y-2" style={{ top: 'var(--header-height, 0px)' }}>
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
              <DropdownMenuCheckboxItem
                checked={filter.length === 0}
                onCheckedChange={() => setFilter([])}
                onSelect={(e) => e.preventDefault()}
              >
                All
              </DropdownMenuCheckboxItem>
              {filterOptions.map((opt) => (
                <DropdownMenuCheckboxItem
                  key={opt.value}
                  checked={filter.includes(opt.value)}
                  onCheckedChange={() => setFilter(
                    filter.includes(opt.value)
                      ? filter.filter((f) => f !== opt.value)
                      : [...filter, opt.value]
                  )}
                  onSelect={(e) => e.preventDefault()}
                >
                  {opt.label}
                </DropdownMenuCheckboxItem>
              ))}
              {multiInstance && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Instance</DropdownMenuLabel>
                  <DropdownMenuCheckboxItem
                    checked={instanceFilter === 'all'}
                    onCheckedChange={() => setInstanceFilter('all')}
                    onSelect={(e) => e.preventDefault()}
                  >
                    All instances
                  </DropdownMenuCheckboxItem>
                  {instances.map((inst) => (
                    <DropdownMenuCheckboxItem
                      key={inst.id}
                      checked={instanceFilter === inst.id}
                      onCheckedChange={() => setInstanceFilter(inst.id)}
                      onSelect={(e) => e.preventDefault()}
                    >
                      {inst.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </>
              )}
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
                  onSelect={(e) => e.preventDefault()}
                >
                  {opt.label}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={sortDir === 'asc'}
                onCheckedChange={() => setSortDir('asc')}
                onSelect={(e) => e.preventDefault()}
              >
                Ascending
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={sortDir === 'desc'}
                onCheckedChange={() => setSortDir('desc')}
                onSelect={(e) => e.preventDefault()}
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

          {canBulk && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => (selectionMode ? exit() : enter())}
                  className={`p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors ${
                    selectionMode ? 'bg-primary text-primary-foreground' : 'hover:bg-accent active:bg-accent/80'
                  }`}
                  aria-label={selectionMode ? 'Exit selection' : 'Select series'}
                  aria-pressed={selectionMode}
                >
                  <ListChecks className="h-5 w-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{selectionMode ? 'Exit selection' : 'Select'}</TooltipContent>
            </Tooltip>
          )}

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

          {canAddSeries && (
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
          )}
        </div>

        <SearchBar value={search} onChange={handleSearch} placeholder="Search series..." />
      </div>

      {(() => {
        if (loading) {
          return <PageSpinner />;
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
                    key={`${s.instanceId ?? ''}:${s.id}`}
                    title={s.title}
                    year={s.year}
                    images={s.images}
                    status={s.status}
                    monitored={s.monitored}
                    type="series"
                    href={hrefForSeries(s)}
                    visibleFields={visibleFields}
                    rating={s.ratings?.value}
                    instanceLabel={multiInstance ? s.instanceLabel : undefined}
                    onNavigate={handleNavigateToDetail}
                    selectable={selectionMode}
                    selected={selectedKeys.has(keyOf(s))}
                    onToggleSelect={() => toggle(keyOf(s))}
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
                  key={`${s.instanceId ?? ''}:${s.id}`}
                  title={s.title}
                  year={s.year}
                  images={s.images}
                  href={hrefForSeries(s)}
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
                  instanceLabel={multiInstance ? s.instanceLabel : undefined}
                  onNavigate={handleNavigateToDetail}
                  selectable={selectionMode}
                  selected={selectedKeys.has(keyOf(s))}
                  onToggleSelect={() => toggle(keyOf(s))}
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
                selectable={selectionMode}
                selectedKeys={selectedKeys}
                onToggleSelect={(row) => toggle(`${row.instanceId ?? ''}:${row.id}`)}
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
                key={`${s.instanceId ?? ''}:${s.id}`}
                title={s.title}
                year={s.year}
                images={s.images}
                href={hrefForSeries(s)}
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
                instanceLabel={multiInstance ? s.instanceLabel : undefined}
                onNavigate={handleNavigateToDetail}
                selectable={selectionMode}
                selected={selectedKeys.has(keyOf(s))}
                onToggleSelect={() => toggle(keyOf(s))}
              />
            ))}
            {bottomSpacerHeight > 0 && <div style={{ height: bottomSpacerHeight }} />}
          </div>
        );
      })()}

      {selectionMode && (
        <>
          {/* Spacer so the floating bar doesn't cover the last rows. */}
          <div aria-hidden className="h-24" />
          <BulkActionBar
            count={selectedCount}
            allSelected={allFilteredSelected}
            onToggleSelectAll={toggleSelectAll}
            onCancel={exit}
            canMonitor={canMonitor}
            canTag={canTag}
            canSearch={canSearch}
            canDelete={canDelete}
            tags={tags}
            onMonitor={handleMonitor}
            onApplyTags={handleApplyTags}
            onSearch={handleBulkSearch}
            onDelete={handleDelete}
            itemNoun="series"
          />
        </>
      )}
    </div>
  );
}
