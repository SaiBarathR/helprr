'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { MediaGridSkeleton } from '@/components/ui/media-grid-skeleton';
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
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { useRefreshAction } from '@/lib/hooks/use-refresh-action';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Filter, ArrowUpDown, Plus, RefreshCw, ListChecks, Eye, EyeOff, Search, Trash2, Pencil, FileStack, FileEdit } from 'lucide-react';
import { useCan, useMe, hasCapability } from '@/components/permission-provider';
import { useWatchLookup, useWatchMapReady, useWatchStatus } from '@/components/jellyfin/watch-status-provider';
import { useUIStore } from '@/lib/store';
import { matchesWatchFilter } from '@/lib/watch-status-filter';
import { useBulkSelection } from '@/lib/use-bulk-selection';
import { BulkActionBar } from '@/components/media/bulk-action-bar';
import { getListViewState, setListViewState } from '@/lib/media-list-cache';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { jsonFetcher, ensureArray } from '@/lib/query-fetch';
import { bulkFanOut, parseSeriesSearchTallies, reportBulk } from '@/lib/bulk-fan-out';
import { useUnionTags } from '@/lib/hooks/use-reference-data';
import { type ContextActionGroup } from '@/components/ui/quick-context-menu';
import { MediaDeleteConfirmDialog } from '@/components/media/media-delete-confirm-dialog';
import { RenamePreviewDialog } from '@/components/media/rename-preview-dialog';
import { arrEditHref, arrManageHref } from '@/lib/arr-edit-href';
import { buildMarkWatchedContextAction } from '@/lib/mark-watched-context-action';
import type { SonarrSeriesListItem } from '@/types';

import type { MediaViewMode } from '@/lib/store';

// Stable empty reference so memo deps don't churn before the query resolves.
const EMPTY_SERIES: SonarrSeriesListItem[] = [];

const FIELD_OPTIONS_BY_MODE: Record<MediaViewMode, { value: string; label: string }[]> = {
  posters: [
    { value: 'title', label: 'Title' },
    { value: 'year', label: 'Year' },
    { value: 'rating', label: 'Rating' },
    { value: 'monitored', label: 'Monitored' },
    { value: 'watchStatus', label: 'Watch Status' },
  ],
  overview: [
    { value: 'title', label: 'Title' },
    { value: 'qualityProfile', label: 'Quality Profile' },
    { value: 'rating', label: 'Rating' },
    { value: 'network', label: 'Network' },
    { value: 'sizeOnDisk', label: 'Size on Disk' },
    { value: 'runtime', label: 'Runtime' },
    { value: 'monitored', label: 'Monitored' },
    { value: 'year', label: 'Year' },
    { value: 'episodeProgress', label: 'Episode Progress' },
    { value: 'watchStatus', label: 'Watch Status' },
    { value: 'genres', label: 'Genres' },
    { value: 'overview', label: 'Overview' },
    { value: 'images', label: 'Poster' },
  ],
  table: [
    { value: 'monitored', label: 'Monitored' },
    { value: 'title', label: 'Title' },
    { value: 'year', label: 'Year' },
    { value: 'qualityProfile', label: 'Quality Profile' },
    { value: 'network', label: 'Network' },
    { value: 'episodeProgress', label: 'Episode Progress' },
    { value: 'rating', label: 'Rating' },
    { value: 'watchStatus', label: 'Watch Status' },
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
  const me = useMe();
  const canFilterByWatchStatus = me?.jellyfinLinked === true && hasCapability(me, 'jellyfin.view');
  const watchLookup = useWatchLookup();
  const watchMapReady = useWatchMapReady();
  // Members can't add directly to Sonarr — they request via Seerr from a detail page.
  const canAddSeries = useCan('series.add');
  const canMonitor = useCan('series.editMonitoring');
  const canTag = useCan('series.editTags');
  const canChangePath = useCan('series.changePath');
  const canEditSeries = canMonitor || canTag || canChangePath;
  const canManageFiles = useCan('series.manageFiles');
  const canDelete = useCan('series.delete');
  const canSearch = useCan('activity.manage');
  const { setWatched, canWrite: canSetWatched, isWriting: isWritingWatched } = useWatchStatus();
  const canBulk = canMonitor || canTag || canDelete || canSearch;
  const {
    selectionMode, selectedKeys, count: selectedCount,
    toggle, selectMany, deselectMany, enter, exit,
  } = useBulkSelection();
  const {
    data: seriesData,
    isLoading: loading,
    isError,
    refetch: refetchSeries,
  } = useQuery({
    queryKey: queryKeys.library('sonarr'),
    queryFn: jsonFetcher<SonarrSeriesListItem[]>('/api/sonarr'),
    staleTime: 60_000, // matches the old media-list-cache TTL
    select: ensureArray,
  });
  const series = seriesData ?? EMPTY_SERIES;
  // Quality-profile / tag names are resolved per-instance server-side (item.qualityProfileName,
  // item.tagLabels). The bulk-tag picker still needs the union of every connected instance's
  // tags as suggestions, so fetch those per instance and merge — but only once selection mode
  // is active (the picker's only consumer), not on every list load.
  const instanceIds = useMemo(
    () => [...new Set(series.map((s) => s.instanceId).filter((id): id is string => Boolean(id)))],
    [series]
  );
  const tags = useUnionTags('sonarr', selectionMode ? instanceIds : []);
  const { refreshing, refresh } = useRefreshAction(refetchSeries);
  const [viewportWidth, setViewportWidth] = useState(1280);
  const [containerWidth, setContainerWidth] = useState(0);
  const [contentOffsetTop, setContentOffsetTop] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<SonarrSeriesListItem | null>(null);
  const [renameTarget, setRenameTarget] = useState<{
    title: string;
    seriesId: number;
    instanceId?: string;
  } | null>(null);
  const [deletingTarget, setDeletingTarget] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const hasRestoredScrollRef = useRef(false);
  const hasRestoredSearchRef = useRef(false);

  const viewMode = useUIStore((s) => s.seriesView);
  const setViewMode = useUIStore((s) => s.setSeriesView);
  const posterSize = useUIStore((s) => s.seriesPosterSize);
  const setPosterSize = useUIStore((s) => s.setSeriesPosterSize);
  const sort = useUIStore((s) => s.seriesSort);
  const setSort = useUIStore((s) => s.setSeriesSort);
  const sortDir = useUIStore((s) => s.seriesSortDirection);
  const setSortDir = useUIStore((s) => s.setSeriesSortDirection);
  const filter = useUIStore((s) => s.seriesFilter);
  const setFilter = useUIStore((s) => s.setSeriesFilter);
  const instanceFilter = useUIStore((s) => s.seriesInstanceFilter);
  const setInstanceFilter = useUIStore((s) => s.setSeriesInstanceFilter);
  const watchFilter = useUIStore((s) => s.seriesWatchFilter);
  const setWatchFilter = useUIStore((s) => s.setSeriesWatchFilter);
  const visibleFieldsByMode = useUIStore((s) => s.seriesVisibleFields);
  const setVisibleFieldsForMode = useUIStore((s) => s.setSeriesVisibleFields);
  const search = useUIStore((s) => s.seriesSearch);
  const setSearch = useUIStore((s) => s.setSeriesSearch);

  const visibleFields = visibleFieldsByMode[viewMode];
  const setVisibleFields = useCallback(
    (fields: string[]) => setVisibleFieldsForMode(viewMode, fields),
    [viewMode, setVisibleFieldsForMode]
  );

  const persistViewState = useCallback((scrollY = window.scrollY, searchValue = search) => {
    setListViewState('series', { scrollY, search: searchValue });
  }, [search]);

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
  }, [viewMode, posterSize, loading, series.length, search, filter, watchFilter]);

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

    if (canFilterByWatchStatus && watchMapReady && watchFilter !== 'all') {
      list = list.filter((s) =>
        matchesWatchFilter(watchFilter, watchLookup, 'sonarr', s.instanceId, s.id)
      );
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
          const qA = a.qualityProfileName || '';
          const qB = b.qualityProfileName || '';
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
          const tA = (a.tagLabels ?? []).slice().sort().join(',');
          const tB = (b.tagLabels ?? []).slice().sort().join(',');
          result = tA.localeCompare(tB);
          break;
        }
        default:
          result = 0;
      }

      return sortDir === 'asc' ? result : -result;
    });

    return list;
  }, [series, search, sort, sortDir, filter, instanceFilter, canFilterByWatchStatus, watchMapReady, watchFilter, watchLookup]);

  // ── Bulk selection ────────────────────────────────────────────────────────
  const allFilteredSelected = filtered.length > 0 && filtered.every((s) => selectedKeys.has(keyOf(s)));
  const toggleSelectAll = useCallback(() => {
    // Deselect only the filtered keys (not clear()) so any selection made under a
    // different filter is preserved — the mirror of selectMany(filtered) above.
    if (allFilteredSelected) deselectMany(filtered.map(keyOf));
    else selectMany(filtered.map(keyOf));
  }, [allFilteredSelected, deselectMany, selectMany, filtered, keyOf]);

  const selectedSeries = useMemo(() => {
    const selected: SonarrSeriesListItem[] = [];
    for (const key of selectedKeys) {
      const item = seriesByKey.get(key);
      if (item) selected.push(item);
    }
    return selected;
  }, [selectedKeys, seriesByKey]);

  const fanOutItems = useCallback(async (
    items: SonarrSeriesListItem[],
    run: (instanceId: string | undefined, ids: number[]) => Promise<Response>,
    opts?: Parameters<typeof bulkFanOut>[2],
  ) => {
    const groups = new Map<string | undefined, number[]>();
    for (const item of items) {
      const list = groups.get(item.instanceId) ?? [];
      list.push(item.id);
      groups.set(item.instanceId, list);
    }
    return bulkFanOut(groups, run, opts);
  }, []);

  const runMonitor = useCallback(async (items: SonarrSeriesListItem[], monitored: boolean, leaveSelection = false) => {
    const { ok, fail, firstError } = await fanOutItems(items, (instanceId, ids) =>
      fetch(`/api/sonarr/editor${instanceId ? `?instanceId=${encodeURIComponent(instanceId)}` : ''}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, monitored }),
      }));
    reportBulk(monitored ? 'Monitoring' : 'Unmonitoring', ok, fail, { noun: 'series', pluralNoun: 'series', reason: firstError });
    await refetchSeries();
    if (fail === 0 && leaveSelection) exit();
    return fail === 0;
  }, [fanOutItems, refetchSeries, exit]);

  const handleMonitor = useCallback(
    (monitored: boolean) => runMonitor(selectedSeries, monitored, true).then(() => undefined),
    [runMonitor, selectedSeries],
  );

  const handleApplyTags = useCallback(async (labels: string[], mode: 'add' | 'remove' | 'replace') => {
    const { ok, fail, firstError } = await fanOutItems(selectedSeries, (instanceId, ids) =>
      fetch(`/api/sonarr/editor${instanceId ? `?instanceId=${encodeURIComponent(instanceId)}` : ''}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, tags: labels, applyTags: mode }),
      }));
    reportBulk(
      mode === 'add' ? 'Tagged' : mode === 'remove' ? 'Untagged' : 'Replaced tags on',
      ok,
      fail,
      { noun: 'series', pluralNoun: 'series', reason: firstError }
    );
    await refetchSeries();
    if (fail === 0) exit();
  }, [fanOutItems, selectedSeries, refetchSeries, exit]);

  const runSearch = useCallback(async (items: SonarrSeriesListItem[], leaveSelection = false) => {
    const { ok, fail, firstError } = await fanOutItems(items,
      (instanceId, ids) =>
        fetch(`/api/sonarr/command${instanceId ? `?instanceId=${encodeURIComponent(instanceId)}` : ''}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'SeriesSearch', seriesIds: ids }),
        }),
      { countResult: parseSeriesSearchTallies },
    );
    reportBulk('Searching', ok, fail, { noun: 'series', pluralNoun: 'series', reason: firstError });
    if (fail === 0 && leaveSelection) exit();
    return fail === 0;
  }, [fanOutItems, exit]);

  const handleBulkSearch = useCallback(
    () => runSearch(selectedSeries, true).then(() => undefined),
    [runSearch, selectedSeries],
  );

  const runDelete = useCallback(async (items: SonarrSeriesListItem[], deleteFiles: boolean, leaveSelection = false) => {
    const { ok, fail, firstError } = await fanOutItems(items, (instanceId, ids) =>
      fetch(`/api/sonarr/editor${instanceId ? `?instanceId=${encodeURIComponent(instanceId)}` : ''}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, deleteFiles }),
      }));
    reportBulk('Deleted', ok, fail, { noun: 'series', pluralNoun: 'series', reason: firstError });
    await refetchSeries();
    if (fail === 0 && leaveSelection) exit();
    return fail === 0;
  }, [fanOutItems, refetchSeries, exit]);

  const handleDelete = useCallback(
    (deleteFiles: boolean) => runDelete(selectedSeries, deleteFiles, true).then(() => undefined),
    [runDelete, selectedSeries],
  );

  const confirmSingleDelete = useCallback(async (deleteFiles: boolean) => {
    if (!deleteTarget || deletingTarget) return;
    setDeletingTarget(true);
    try {
      if (await runDelete([deleteTarget], deleteFiles)) setDeleteTarget(null);
    } finally {
      setDeletingTarget(false);
    }
  }, [deleteTarget, deletingTarget, runDelete]);

  const contextActionsByKey = useMemo(() => {
    const result = new Map<string, ContextActionGroup[]>();
    for (const item of series) {
      const key = keyOf(item);
      const seriesWatch = watchLookup({
        scope: 'sonarr',
        instanceId: item.instanceId,
        arrId: item.id,
        kind: 'series',
      });
      const watchedAction = buildMarkWatchedContextAction({
        status: seriesWatch,
        canWrite: canSetWatched,
        isWriting: isWritingWatched,
        setWatched,
      });
      result.set(key, [
        {
          id: 'navigation',
          actions: [
            { id: 'open', label: 'Open details', href: hrefForSeries(item), onNavigate: handleNavigateToDetail },
            ...(canEditSeries
              ? [{
                  id: 'edit',
                  label: 'Edit',
                  icon: <Pencil className="h-4 w-4" />,
                  href: arrEditHref('series', item.id, item.instanceId),
                }]
              : []),
          ],
        },
        {
          id: 'state',
          actions: [
            ...(watchedAction ? [watchedAction] : []),
            ...(canMonitor
              ? [{
                  id: 'monitor',
                  label: item.monitored ? 'Unmonitor' : 'Monitor',
                  icon: item.monitored ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />,
                  onSelect: () => { void runMonitor([item], !item.monitored); },
                }]
              : []),
          ],
        },
        {
          id: 'organize',
          actions: [
            ...(canSearch
              ? [{
                  id: 'search',
                  label: 'Automatic search',
                  icon: <Search className="h-4 w-4" />,
                  onSelect: () => { void runSearch([item]); },
                }]
              : []),
            ...(canManageFiles
              ? [{
                  id: 'files',
                  label: 'Manage episodes',
                  icon: <FileStack className="h-4 w-4" />,
                  href: arrManageHref('series', item.id, item.title, item.instanceId),
                }]
              : []),
            ...(canSearch
              ? [{
                  id: 'rename',
                  label: 'Preview rename…',
                  icon: <FileEdit className="h-4 w-4" />,
                  onSelect: () => {
                    setRenameTarget({
                      title: item.title,
                      seriesId: item.id,
                      instanceId: item.instanceId,
                    });
                  },
                }]
              : []),
          ],
        },
        {
          id: 'actions',
          actions: [
            ...(canBulk
              ? [{
                  id: 'select',
                  label: 'Select',
                  icon: <ListChecks className="h-4 w-4" />,
                  onSelect: () => { enter(); toggle(key); },
                }]
              : []),
            ...(canDelete
              ? [{
                  id: 'delete',
                  label: 'Delete series',
                  icon: <Trash2 className="h-4 w-4" />,
                  onSelect: () => setDeleteTarget(item),
                  destructive: true,
                }]
              : []),
          ],
        },
      ]);
    }
    return result;
  }, [
    series,
    keyOf,
    hrefForSeries,
    handleNavigateToDetail,
    watchLookup,
    canSetWatched,
    isWritingWatched,
    setWatched,
    canEditSeries,
    canMonitor,
    canSearch,
    canManageFiles,
    canBulk,
    canDelete,
    runMonitor,
    runSearch,
    enter,
    toggle,
  ]);

  const contextActionsForSeries = useCallback(
    (item: SonarrSeriesListItem) => contextActionsByKey.get(keyOf(item)) ?? [],
    [contextActionsByKey, keyOf],
  );

  const contextActionsForTableRow = useCallback(
    (row: { id: number; instanceId?: string }) => contextActionsByKey.get(`${row.instanceId ?? ''}:${row.id}`) ?? [],
    [contextActionsByKey],
  );

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

  const tableRows = useMemo(() => filtered.map((s) => ({
    id: s.id,
    title: s.title,
    year: s.year,
    href: hrefForSeries(s),
    instanceId: s.instanceId,
    instanceLabel: multiInstance ? s.instanceLabel : undefined,
    monitored: s.monitored,
    status: s.status,
    images: s.images,
    qualityProfile: s.qualityProfileName,
    network: s.network,
    rating: s.ratings?.value,
    sizeOnDisk: s.statistics.sizeOnDisk,
    episodeProgress: `${s.statistics.episodeCount}/${s.statistics.totalEpisodeCount}`,
    runtime: s.runtime,
    genres: s.genres,
  })), [filtered, multiInstance, hrefForSeries]);

  // Table headers sort through the same store state as the toolbar dropdown:
  // picking the active key toggles direction; a new key gets its natural default.
  const handleHeaderSort = useCallback((key: string) => {
    if (sort === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSort(key as typeof sort);
      const alphabetic = ['title', 'network', 'qualityProfile', 'path', 'originalLanguage', 'tags'];
      setSortDir(alphabetic.includes(key) ? 'asc' : 'desc');
    }
  }, [sort, sortDir, setSort, setSortDir]);

  const activeFilterLabel = useMemo(() => {
    const arrLabel = filter.length === 0
      ? null
      : filter.length === 1
        ? filterOptions.find((o) => o.value === filter[0])?.label ?? filter[0]
        : `${filter.length} filters`;
    const watchLabel = canFilterByWatchStatus && watchFilter === 'watched'
      ? 'Watched'
      : canFilterByWatchStatus && watchFilter === 'unwatched'
        ? 'Not watched'
        : null;
    if (arrLabel && watchLabel) return `${arrLabel}, ${watchLabel}`;
    if (arrLabel) return arrLabel;
    if (watchLabel) return watchLabel;
    return 'All';
  }, [filter, watchFilter, canFilterByWatchStatus]);
  const activeSortLabel = sortOptions.find((o) => o.value === sort)?.label ?? 'Title';

  return (
    <div className="space-y-3 animate-content-in">
      <PullToRefresh onRefresh={() => refetchSeries()} disabled={selectionMode} />
      <div className="page-toolbar page-toolbar-flush pb-2 app-chrome-bar bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 space-y-2">
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
              {canFilterByWatchStatus && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Watch status</DropdownMenuLabel>
                  <DropdownMenuCheckboxItem
                    checked={watchFilter === 'all'}
                    onCheckedChange={() => setWatchFilter('all')}
                    onSelect={(e) => e.preventDefault()}
                  >
                    All
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={watchFilter === 'watched'}
                    onCheckedChange={() => setWatchFilter('watched')}
                    onSelect={(e) => e.preventDefault()}
                  >
                    Watched
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={watchFilter === 'unwatched'}
                    onCheckedChange={() => setWatchFilter('unwatched')}
                    onSelect={(e) => e.preventDefault()}
                  >
                    Not watched
                  </DropdownMenuCheckboxItem>
                </>
              )}
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
                onClick={refresh}
                disabled={refreshing}
                className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors disabled:opacity-60 disabled:cursor-default"
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

        <SearchBar value={search} onChange={handleSearch} placeholder="Search series..." historyKey="series" debounceMs={250} />
      </div>

      {(() => {
        if (loading && series.length === 0) {
          return <MediaGridSkeleton gridClassName={posterGridClass} />;
        }

        if (filtered.length === 0) {
          // Distinguish a fetch failure (nothing cached) from a genuinely empty
          // library — the former offers Retry, not "add a connection".
          if (isError && series.length === 0) {
            return (
              <div className="text-center py-12 text-muted-foreground">
                <p>Couldn&apos;t load your library — check the connection.</p>
                <button
                  onClick={() => void refetchSeries()}
                  className="mt-3 inline-flex items-center justify-center rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent active:bg-accent/80 transition-colors"
                >
                  Retry
                </button>
              </div>
            );
          }
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
                {visibleSeries.map((s, i) => (
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
                    watchLookup={{ scope: 'sonarr', instanceId: s.instanceId, arrId: s.id }}
                    rating={s.ratings?.value}
                    instanceLabel={multiInstance ? s.instanceLabel : undefined}
                    onNavigate={handleNavigateToDetail}
                    imagePriority={startIndex + i < Math.min(posterColumns * 2, 4)}
                    selectable={selectionMode}
                    selected={selectedKeys.has(keyOf(s))}
                    onToggleSelect={() => toggle(keyOf(s))}
                    contextActionGroups={contextActionsForSeries(s)}
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
              {visibleSeries.map((s, i) => (
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
                  watchLookup={{ scope: 'sonarr', instanceId: s.instanceId, arrId: s.id }}
                  qualityProfile={s.qualityProfileName}
                  network={s.network}
                  overview={s.overview}
                  rating={s.ratings?.value}
                  sizeOnDisk={s.statistics.sizeOnDisk}
                  runtime={s.runtime}
                  episodeProgress={`${s.statistics.episodeCount}/${s.statistics.totalEpisodeCount}`}
                  genres={s.genres}
                  instanceLabel={multiInstance ? s.instanceLabel : undefined}
                  onNavigate={handleNavigateToDetail}
                  imagePriority={startIndex + i < 6}
                  selectable={selectionMode}
                  selected={selectedKeys.has(keyOf(s))}
                  onToggleSelect={() => toggle(keyOf(s))}
                  contextActionGroups={contextActionsForSeries(s)}
                />
              ))}
              {bottomSpacerHeight > 0 && <div style={{ height: bottomSpacerHeight }} />}
            </div>
          );
        }

        return (
          <div ref={contentRef}>
            <MediaTable
              type="series"
              watchScope="sonarr"
              visibleFields={visibleFields}
              rows={tableRows}
              onNavigate={handleNavigateToDetail}
              selectable={selectionMode}
              selectedKeys={selectedKeys}
              onToggleSelect={(row) => toggle(`${row.instanceId ?? ''}:${row.id}`)}
              getContextActionGroups={contextActionsForTableRow}
              sortKey={sort}
              sortDir={sortDir}
              onSort={handleHeaderSort}
              sortKeys={{
                title: 'title',
                year: 'year',
                qualityProfile: 'qualityProfile',
                network: 'network',
                sizeOnDisk: 'sizeOnDisk',
                monitored: 'monitored',
                rating: 'rating',
                episodeProgress: 'episodes',
              }}
              resetPageKey={`${search}|${filter.join(',')}|${instanceFilter}|${watchFilter}|${sort}|${sortDir}`}
            />
          </div>
        );
      })()}

      <RenamePreviewDialog
        open={renameTarget !== null}
        onOpenChange={(open) => { if (!open) setRenameTarget(null); }}
        service="sonarr"
        mediaId={renameTarget?.seriesId ?? 0}
        mediaTitle={renameTarget?.title ?? ''}
        instanceId={renameTarget?.instanceId}
      />

      <MediaDeleteConfirmDialog
        key={deleteTarget ? keyOf(deleteTarget) : 'no-delete-target'}
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open && !deletingTarget) setDeleteTarget(null); }}
        title={`Delete “${deleteTarget?.title ?? ''}”?`}
        description={`This removes the series from its connected service.`}
        busy={deletingTarget}
        onConfirm={confirmSingleDelete}
      />

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
