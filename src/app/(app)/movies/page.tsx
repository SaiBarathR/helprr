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
import { MoviesSubNav } from '@/components/media/movies-subnav';
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
import { bulkFanOut, reportBulk } from '@/lib/bulk-fan-out';
import { useUnionTags } from '@/lib/hooks/use-reference-data';
import { type ContextActionGroup } from '@/components/ui/quick-context-menu';
import { SingleMediaDeleteDialog } from '@/components/media/single-media-delete-dialog';
import { InteractiveSearchDialog } from '@/components/media/interactive-search-dialog';
import { RenamePreviewDialog } from '@/components/media/rename-preview-dialog';
import { arrEditHref, arrManageHref } from '@/lib/arr-edit-href';
import { buildMarkWatchedContextAction } from '@/lib/mark-watched-context-action';
import type { RadarrMovieListItem } from '@/types';

import type { MediaViewMode } from '@/lib/store';

// Stable empty reference so memo deps don't churn before the query resolves.
const EMPTY_MOVIES: RadarrMovieListItem[] = [];

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
    { value: 'studio', label: 'Studio' },
    { value: 'certification', label: 'Certification' },
    { value: 'sizeOnDisk', label: 'Size on Disk' },
    { value: 'runtime', label: 'Runtime' },
    { value: 'monitored', label: 'Monitored' },
    { value: 'year', label: 'Year' },
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
    { value: 'studio', label: 'Studio' },
    { value: 'rating', label: 'Rating' },
    { value: 'watchStatus', label: 'Watch Status' },
    { value: 'sizeOnDisk', label: 'Size on Disk' },
  ],
};

const filterOptions = [
  { value: 'monitored', label: 'Monitored' },
  { value: 'unmonitored', label: 'Unmonitored' },
  { value: 'missing', label: 'Missing' },
  { value: 'hasFile', label: 'On Disk' },
  { value: 'released', label: 'Released' },
  { value: 'inCinemas', label: 'In Cinemas' },
  { value: 'announced', label: 'Announced' },
] as const;

const sortOptions = [
  { value: 'title', label: 'Title' },
  { value: 'originalTitle', label: 'Original Title' },
  { value: 'year', label: 'Year' },
  { value: 'dateAdded', label: 'Added' },
  { value: 'imdbRating', label: 'IMDb Rating' },
  { value: 'tmdbRating', label: 'TMDb Rating' },
  { value: 'tomatoRating', label: 'Tomato Rating' },
  { value: 'traktRating', label: 'Trakt Rating' },
  { value: 'popularity', label: 'Popularity' },
  { value: 'sizeOnDisk', label: 'Size on Disk' },
  { value: 'runtime', label: 'Runtime' },
  { value: 'inCinemas', label: 'In Cinemas' },
  { value: 'digitalRelease', label: 'Digital Release' },
  { value: 'physicalRelease', label: 'Physical Release' },
  { value: 'studio', label: 'Studio' },
  { value: 'qualityProfile', label: 'Quality Profile' },
  { value: 'monitored', label: 'Monitored/Status' },
  { value: 'path', label: 'Path' },
  { value: 'certification', label: 'Certification' },
  { value: 'originalLanguage', label: 'Original Language' },
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

function ensurePaintedOrHeightReached(targetScrollY: number, timeoutMs = 1200, pollMs = 50) {
  return new Promise<void>((resolve) => {
    const startedAt = Date.now();
    let done = false;
    let loadTimeoutId: number | null = null;

    const finish = () => {
      if (done) return;
      done = true;
      if (loadTimeoutId !== null) window.clearTimeout(loadTimeoutId);
      resolve();
    };

    const waitForHeight = () => {
      if (done) return;
      const maxScrollTop = Math.max(0, document.body.scrollHeight - window.innerHeight);
      const reachedHeight = maxScrollTop >= targetScrollY;
      const timedOut = Date.now() - startedAt >= timeoutMs;
      if (reachedHeight || timedOut) {
        finish();
        return;
      }
      window.setTimeout(waitForHeight, pollMs);
    };

    if (document.readyState !== 'complete') {
      const onLoad = () => {
        window.removeEventListener('load', onLoad);
        waitForHeight();
      };
      window.addEventListener('load', onLoad, { once: true });
      loadTimeoutId = window.setTimeout(() => {
        window.removeEventListener('load', onLoad);
        waitForHeight();
      }, timeoutMs);
      return;
    }

    waitForHeight();
  });
}

/**
 * Render the Movies management page with client-side data loading, filtering, sorting, and multiple view modes (posters, overview, table).
 *
 * Fetches movies, quality profiles, and tags on mount and maintains local state for search, filters, sort, poster size, and visible fields per view mode.
 * The component derives a filtered, sorted list from the loaded movies and renders one of:
 * - a poster grid,
 * - an overview list,
 * - or a table with a mobile overview fallback.
 *
 * @returns The Movies page JSX element.
 */
export default function MoviesPage() {
  const me = useMe();
  const canFilterByWatchStatus = me?.jellyfinLinked === true && hasCapability(me, 'jellyfin.view');
  const watchLookup = useWatchLookup();
  const watchMapReady = useWatchMapReady();
  // Members can't add directly to Radarr — they request via Seerr from a detail page.
  const canAddMovies = useCan('movies.add');
  const canMonitor = useCan('movies.editMonitoring');
  const canTag = useCan('movies.editTags');
  const canChangePath = useCan('movies.changePath');
  const canEditMovie = canMonitor || canTag || canChangePath;
  const canManageFiles = useCan('movies.manageFiles');
  const canDelete = useCan('movies.delete');
  const canSearch = useCan('activity.manage');
  const { setWatched, canWrite: canSetWatched, isWriting: isWritingWatched } = useWatchStatus();
  const canBulk = canMonitor || canTag || canDelete || canSearch;
  const {
    selectionMode, selectedKeys, count: selectedCount,
    toggle, selectMany, deselectMany, enter, exit,
  } = useBulkSelection();
  const {
    data: moviesData,
    isLoading: loading,
    isError,
    refetch: refetchMovies,
  } = useQuery({
    queryKey: queryKeys.library('radarr'),
    queryFn: jsonFetcher<RadarrMovieListItem[]>('/api/radarr'),
    staleTime: 60_000, // matches the old media-list-cache TTL
    select: ensureArray,
  });
  const movies = moviesData ?? EMPTY_MOVIES;
  // Quality-profile / tag names are resolved per-instance server-side (item.qualityProfileName,
  // item.tagLabels). The bulk-tag picker still needs the union of every connected instance's
  // tags as suggestions, so fetch those per instance and merge — but only once selection mode
  // is active (the picker's only consumer), not on every list load.
  const instanceIds = useMemo(
    () => [...new Set(movies.map((m) => m.instanceId).filter((id): id is string => Boolean(id)))],
    [movies]
  );
  const tags = useUnionTags('radarr', selectionMode ? instanceIds : []);
  const { refreshing, refresh } = useRefreshAction(refetchMovies);
  const [viewportWidth, setViewportWidth] = useState(1280);
  const [containerWidth, setContainerWidth] = useState(0);
  const [contentOffsetTop, setContentOffsetTop] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<RadarrMovieListItem | null>(null);
  const [interactiveSearchTarget, setInteractiveSearchTarget] = useState<{
    title: string;
    movieId: number;
    instanceId?: string;
  } | null>(null);
  const [renameTarget, setRenameTarget] = useState<{
    title: string;
    movieId: number;
    instanceId?: string;
  } | null>(null);
  const [deletingTarget, setDeletingTarget] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const hasRestoredScrollRef = useRef(false);
  const hasRestoredSearchRef = useRef(false);

  const viewMode = useUIStore((s) => s.moviesView);
  const setViewMode = useUIStore((s) => s.setMoviesView);
  const posterSize = useUIStore((s) => s.moviesPosterSize);
  const setPosterSize = useUIStore((s) => s.setMoviesPosterSize);
  const sort = useUIStore((s) => s.moviesSort);
  const setSort = useUIStore((s) => s.setMoviesSort);
  const sortDir = useUIStore((s) => s.moviesSortDirection);
  const setSortDir = useUIStore((s) => s.setMoviesSortDirection);
  const filter = useUIStore((s) => s.moviesFilter);
  const setFilter = useUIStore((s) => s.setMoviesFilter);
  const instanceFilter = useUIStore((s) => s.moviesInstanceFilter);
  const setInstanceFilter = useUIStore((s) => s.setMoviesInstanceFilter);
  const watchFilter = useUIStore((s) => s.moviesWatchFilter);
  const setWatchFilter = useUIStore((s) => s.setMoviesWatchFilter);
  const visibleFieldsByMode = useUIStore((s) => s.moviesVisibleFields);
  const setVisibleFieldsForMode = useUIStore((s) => s.setMoviesVisibleFields);
  const search = useUIStore((s) => s.moviesSearch);
  const setSearch = useUIStore((s) => s.setMoviesSearch);

  const visibleFields = visibleFieldsByMode[viewMode];
  const setVisibleFields = useCallback(
    (fields: string[]) => setVisibleFieldsForMode(viewMode, fields),
    [viewMode, setVisibleFieldsForMode]
  );

  const persistViewState = useCallback((scrollY = window.scrollY, searchValue = search) => {
    setListViewState('movies', { scrollY, search: searchValue });
  }, [search]);

  useEffect(() => {
    if (hasRestoredSearchRef.current) return;
    hasRestoredSearchRef.current = true;

    const saved = getListViewState('movies');
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
  }, [viewMode, posterSize, loading, movies.length, search, filter, watchFilter]);

  useEffect(() => {
    if (loading || hasRestoredScrollRef.current) return;

    const saved = getListViewState('movies');
    if (!saved || saved.scrollY <= 0) {
      hasRestoredScrollRef.current = true;
      return;
    }

    let cancelled = false;
    void (async () => {
      await ensurePaintedOrHeightReached(saved.scrollY);
      if (cancelled) return;
      window.scrollTo({ top: saved.scrollY, behavior: 'instant' });
      hasRestoredScrollRef.current = true;
    })();

    return () => {
      cancelled = true;
    };
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

  // Connected instances derived from the (already instance-tagged) list.
  const instances = useMemo(() => {
    const m = new Map<string, string>();
    for (const movie of movies) if (movie.instanceId) m.set(movie.instanceId, movie.instanceLabel ?? movie.instanceId);
    return [...m].map(([id, label]) => ({ id, label }));
  }, [movies]);
  const multiInstance = instances.length > 1;
  const hrefForMovie = useCallback(
    (movie: RadarrMovieListItem) => (movie.instanceId ? `/movies/${movie.id}?instance=${movie.instanceId}` : `/movies/${movie.id}`),
    []
  );

  // Selection keys are composite so ids that repeat across instances stay distinct.
  const keyOf = useCallback((movie: RadarrMovieListItem) => `${movie.instanceId ?? ''}:${movie.id}`, []);
  const movieByKey = useMemo(() => {
    const map = new Map<string, RadarrMovieListItem>();
    for (const movie of movies) map.set(keyOf(movie), movie);
    return map;
  }, [movies, keyOf]);

  // Drop a stale instance filter if that instance is no longer connected.
  useEffect(() => {
    if (instanceFilter !== 'all' && !instances.some((i) => i.id === instanceFilter)) {
      setInstanceFilter('all');
    }
  }, [instances, instanceFilter, setInstanceFilter]);

  const filtered = useMemo(() => {
    let list = movies;

    if (search) {
      const q = search.toLowerCase();
      list = list.filter((m) => m.title.toLowerCase().includes(q));
    }

    if (filter.length > 0) {
      list = list.filter((m) => filter.some((f) => {
        if (f === 'monitored') return m.monitored;
        if (f === 'unmonitored') return !m.monitored;
        if (f === 'missing') return m.monitored && !m.hasFile;
        if (f === 'hasFile') return m.hasFile;
        if (f === 'released') return m.status === 'released';
        if (f === 'inCinemas') return m.status === 'inCinemas';
        if (f === 'announced') return m.status === 'announced';
        return true;
      }));
    }

    if (instanceFilter !== 'all') {
      list = list.filter((movie) => movie.instanceId === instanceFilter);
    }

    if (canFilterByWatchStatus && watchMapReady && watchFilter !== 'all') {
      list = list.filter((movie) =>
        matchesWatchFilter(watchFilter, watchLookup, 'radarr', movie.instanceId, movie.id)
      );
    }

    list = [...list].sort((a, b) => {
      let result = 0;

      switch (sort) {
        case 'title':
          result = a.sortTitle.localeCompare(b.sortTitle);
          break;
        case 'originalTitle':
          result = (a.originalTitle || a.title).localeCompare(b.originalTitle || b.title);
          break;
        case 'year':
          result = a.year - b.year;
          break;
        case 'dateAdded':
          result = new Date(a.added).getTime() - new Date(b.added).getTime();
          break;
        case 'sizeOnDisk':
          result = a.sizeOnDisk - b.sizeOnDisk;
          break;
        case 'runtime':
          result = a.runtime - b.runtime;
          break;
        case 'studio':
          result = (a.studio || '').localeCompare(b.studio || '');
          break;
        case 'qualityProfile': {
          const qA = a.qualityProfileName || '';
          const qB = b.qualityProfileName || '';
          result = qA.localeCompare(qB);
          break;
        }
        case 'monitored':
          result = (a.monitored === b.monitored) ? 0 : a.monitored ? -1 : 1;
          break;
        case 'inCinemas':
          result = new Date(a.inCinemas || 0).getTime() - new Date(b.inCinemas || 0).getTime();
          break;
        case 'digitalRelease':
          result = new Date(a.digitalRelease || 0).getTime() - new Date(b.digitalRelease || 0).getTime();
          break;
        case 'physicalRelease':
          result = new Date(a.physicalRelease || 0).getTime() - new Date(b.physicalRelease || 0).getTime();
          break;
        case 'popularity':
          result = (a.popularity || 0) - (b.popularity || 0);
          break;
        case 'imdbRating':
          result = (a.ratings?.imdb?.value || 0) - (b.ratings?.imdb?.value || 0);
          break;
        case 'tmdbRating':
          result = (a.ratings?.tmdb?.value || 0) - (b.ratings?.tmdb?.value || 0);
          break;
        case 'tomatoRating':
          result = (a.ratings?.rottenTomatoes?.value || 0) - (b.ratings?.rottenTomatoes?.value || 0);
          break;
        case 'traktRating':
          result = (a.ratings?.trakt?.value || 0) - (b.ratings?.trakt?.value || 0);
          break;
        case 'path':
          result = (a.path || '').localeCompare(b.path || '');
          break;
        case 'certification':
          result = (a.certification || '').localeCompare(b.certification || '');
          break;
        case 'originalLanguage':
          result = (a.originalLanguage?.name || '').localeCompare(b.originalLanguage?.name || '');
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
  }, [movies, search, sort, sortDir, filter, instanceFilter, canFilterByWatchStatus, watchMapReady, watchFilter, watchLookup]);

  // ── Bulk selection ────────────────────────────────────────────────────────
  const allFilteredSelected = filtered.length > 0 && filtered.every((m) => selectedKeys.has(keyOf(m)));
  const toggleSelectAll = useCallback(() => {
    // Deselect only the filtered keys (not clear()) so any selection made under a
    // different filter is preserved — the mirror of selectMany(filtered) above.
    if (allFilteredSelected) deselectMany(filtered.map(keyOf));
    else selectMany(filtered.map(keyOf));
  }, [allFilteredSelected, deselectMany, selectMany, filtered, keyOf]);

  const selectedMovies = useMemo(() => {
    const selected: RadarrMovieListItem[] = [];
    for (const key of selectedKeys) {
      const movie = movieByKey.get(key);
      if (movie) selected.push(movie);
    }
    return selected;
  }, [selectedKeys, movieByKey]);

  const fanOutItems = useCallback(async (
    items: RadarrMovieListItem[],
    run: (instanceId: string | undefined, ids: number[]) => Promise<Response>,
    opts?: Parameters<typeof bulkFanOut>[2],
  ) => {
    const groups = new Map<string | undefined, number[]>();
    for (const movie of items) {
      const list = groups.get(movie.instanceId) ?? [];
      list.push(movie.id);
      groups.set(movie.instanceId, list);
    }
    return bulkFanOut(groups, run, opts);
  }, []);

  const runMonitor = useCallback(async (items: RadarrMovieListItem[], monitored: boolean, leaveSelection = false) => {
    const { ok, fail, firstError } = await fanOutItems(items, (instanceId, ids) =>
      fetch(`/api/radarr/editor${instanceId ? `?instanceId=${encodeURIComponent(instanceId)}` : ''}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, monitored }),
      }));
    reportBulk(monitored ? 'Monitoring' : 'Unmonitoring', ok, fail, { noun: 'movie', pluralNoun: 'movies', reason: firstError });
    await refetchMovies();
    if (fail === 0 && leaveSelection) exit();
    return fail === 0;
  }, [fanOutItems, refetchMovies, exit]);

  const handleMonitor = useCallback(
    (monitored: boolean) => runMonitor(selectedMovies, monitored, true).then(() => undefined),
    [runMonitor, selectedMovies],
  );

  const handleApplyTags = useCallback(async (labels: string[], mode: 'add' | 'remove' | 'replace') => {
    const { ok, fail, firstError } = await fanOutItems(selectedMovies, (instanceId, ids) =>
      fetch(`/api/radarr/editor${instanceId ? `?instanceId=${encodeURIComponent(instanceId)}` : ''}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, tags: labels, applyTags: mode }),
      }));
    reportBulk(
      mode === 'add' ? 'Tagged' : mode === 'remove' ? 'Untagged' : 'Replaced tags on',
      ok,
      fail,
      { noun: 'movie', pluralNoun: 'movies', reason: firstError }
    );
    await refetchMovies();
    if (fail === 0) exit();
  }, [fanOutItems, selectedMovies, refetchMovies, exit]);

  const runSearch = useCallback(async (items: RadarrMovieListItem[], leaveSelection = false) => {
    const { ok, fail, firstError } = await fanOutItems(items, (instanceId, ids) =>
      fetch(`/api/radarr/command${instanceId ? `?instanceId=${encodeURIComponent(instanceId)}` : ''}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'MoviesSearch', movieIds: ids }),
      }));
    reportBulk('Searching', ok, fail, { noun: 'movie', pluralNoun: 'movies', reason: firstError });
    if (fail === 0 && leaveSelection) exit();
    return fail === 0;
  }, [fanOutItems, exit]);

  const handleBulkSearch = useCallback(
    () => runSearch(selectedMovies, true).then(() => undefined),
    [runSearch, selectedMovies],
  );

  const runDelete = useCallback(async (items: RadarrMovieListItem[], deleteFiles: boolean, leaveSelection = false) => {
    const { ok, fail, firstError } = await fanOutItems(items, (instanceId, ids) =>
      fetch(`/api/radarr/editor${instanceId ? `?instanceId=${encodeURIComponent(instanceId)}` : ''}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, deleteFiles }),
      }));
    reportBulk('Deleted', ok, fail, { noun: 'movie', pluralNoun: 'movies', reason: firstError });
    await refetchMovies();
    if (fail === 0 && leaveSelection) exit();
    return fail === 0;
  }, [fanOutItems, refetchMovies, exit]);

  const handleDelete = useCallback(
    (deleteFiles: boolean) => runDelete(selectedMovies, deleteFiles, true).then(() => undefined),
    [runDelete, selectedMovies],
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
    for (const movie of movies) {
      const key = keyOf(movie);
      const movieWatch = watchLookup({
        scope: 'radarr',
        instanceId: movie.instanceId,
        arrId: movie.id,
        kind: 'movie',
      });
      const watchedAction = buildMarkWatchedContextAction({
        status: movieWatch,
        canWrite: canSetWatched,
        isWriting: isWritingWatched,
        setWatched,
      });
      result.set(key, [
        {
          id: 'navigation',
          actions: [
            { id: 'open', label: 'Open details', href: hrefForMovie(movie), onNavigate: handleNavigateToDetail },
            ...(canEditMovie
              ? [{
                  id: 'edit',
                  label: 'Edit',
                  icon: <Pencil className="h-4 w-4" />,
                  href: arrEditHref('movie', movie.id, movie.instanceId),
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
                  label: movie.monitored ? 'Unmonitor' : 'Monitor',
                  icon: movie.monitored ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />,
                  onSelect: () => { void runMonitor([movie], !movie.monitored); },
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
                  onSelect: () => { void runSearch([movie]); },
                }]
              : []),
            ...(canSearch
              ? [{
                  id: 'interactive',
                  label: 'Interactive search…',
                  icon: <Search className="h-4 w-4" />,
                  onSelect: () => {
                    setInteractiveSearchTarget({
                      title: movie.title,
                      movieId: movie.id,
                      instanceId: movie.instanceId,
                    });
                  },
                }]
              : []),
            ...(canManageFiles
              ? [{
                  id: 'files',
                  label: 'Manage files',
                  icon: <FileStack className="h-4 w-4" />,
                  href: arrManageHref('movie', movie.id, movie.title, movie.instanceId),
                }]
              : []),
            ...(canSearch
              ? [{
                  id: 'rename',
                  label: 'Preview rename…',
                  icon: <FileEdit className="h-4 w-4" />,
                  onSelect: () => {
                    setRenameTarget({
                      title: movie.title,
                      movieId: movie.id,
                      instanceId: movie.instanceId,
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
                  label: 'Delete movie',
                  icon: <Trash2 className="h-4 w-4" />,
                  onSelect: () => setDeleteTarget(movie),
                  destructive: true,
                }]
              : []),
          ],
        },
      ]);
    }
    return result;
  }, [
    movies,
    keyOf,
    hrefForMovie,
    handleNavigateToDetail,
    watchLookup,
    canSetWatched,
    isWritingWatched,
    setWatched,
    canEditMovie,
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

  const contextActionsForMovie = useCallback(
    (movie: RadarrMovieListItem) => contextActionsByKey.get(keyOf(movie)) ?? [],
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

  const tableRows = useMemo(() => (
    filtered.map((movie) => ({
      id: movie.id,
      title: movie.title,
      year: movie.year,
      href: hrefForMovie(movie),
      instanceId: movie.instanceId,
      instanceLabel: multiInstance ? movie.instanceLabel : undefined,
      monitored: movie.monitored,
      hasFile: movie.hasFile,
      status: movie.status,
      images: movie.images,
      qualityProfile: movie.qualityProfileName,
      studio: movie.studio,
      rating: movie.ratings?.imdb?.value || movie.ratings?.tmdb?.value,
      sizeOnDisk: movie.sizeOnDisk,
      runtime: movie.runtime,
      certification: movie.certification,
      genres: movie.genres,
    }))
  ), [filtered, multiInstance, hrefForMovie]);

  // Table headers sort through the same store state as the toolbar dropdown:
  // picking the active key toggles direction; a new key gets its natural default.
  const handleHeaderSort = useCallback((key: string) => {
    if (sort === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSort(key as typeof sort);
      const alphabetic = ['title', 'originalTitle', 'studio', 'qualityProfile', 'path', 'certification', 'originalLanguage', 'tags'];
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
      <PullToRefresh onRefresh={() => refetchMovies()} disabled={selectionMode} />
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
                  aria-label={selectionMode ? 'Exit selection' : 'Select movies'}
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
                aria-label="Refresh Movies"
              >
                <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Refresh Movies</TooltipContent>
          </Tooltip>

          {canAddMovies && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href="/movies/add"
                  className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors"
                  aria-label="Add Movie"
                >
                  <Plus className="h-5 w-5" />
                </Link>
              </TooltipTrigger>
              <TooltipContent>Add Movie</TooltipContent>
            </Tooltip>
          )}
        </div>

        <div className="flex items-center gap-2">
          <MoviesSubNav active="library" />
          <div className="flex-1 min-w-0">
            <SearchBar value={search} onChange={handleSearch} placeholder="Search movies..." historyKey="movies" debounceMs={250} />
          </div>
        </div>
      </div>

      {(() => {
        if (loading && movies.length === 0) {
          return <MediaGridSkeleton gridClassName={posterGridClass} />;
        }

        if (filtered.length === 0) {
          // Distinguish a fetch failure (nothing cached) from a genuinely empty
          // library — the former offers Retry, not "add a connection".
          if (isError && movies.length === 0) {
            return (
              <div className="text-center py-12 text-muted-foreground">
                <p>Couldn&apos;t load your library — check the connection.</p>
                <button
                  onClick={() => void refetchMovies()}
                  className="mt-3 inline-flex items-center justify-center rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent active:bg-accent/80 transition-colors"
                >
                  Retry
                </button>
              </div>
            );
          }
          return (
            <div className="text-center py-12 text-muted-foreground">
              {movies.length === 0
                ? 'No movies found. Add your Radarr connection in Settings.'
                : 'No movies match your filters.'}
            </div>
          );
        }

        if (effectiveView === 'posters') {
          const virtualRows = posterVirtualizer.getVirtualItems();
          const firstRow = virtualRows[0];
          const lastRow = virtualRows[virtualRows.length - 1];
          const startIndex = (firstRow?.index ?? 0) * posterColumns;
          const endIndex = Math.min(filtered.length, ((lastRow?.index ?? 0) + 1) * posterColumns);
          const visibleMovies = filtered.slice(startIndex, endIndex);
          const topSpacerHeight = firstRow ? Math.max(0, firstRow.start - contentOffsetTop) : 0;
          const bottomSpacerHeight = lastRow
            ? Math.max(0, posterVirtualizer.getTotalSize() - (lastRow.end - contentOffsetTop))
            : 0;

          return (
            <div ref={contentRef}>
              {topSpacerHeight > 0 && <div style={{ height: topSpacerHeight }} />}
              <div className={posterGridClass}>
                {visibleMovies.map((movie, i) => (
                  <MediaCard
                    key={`${movie.instanceId ?? ''}:${movie.id}`}
                    title={movie.title}
                    year={movie.year}
                    images={movie.images}
                    hasFile={movie.hasFile}
                    monitored={movie.monitored}
                    type="movie"
                    href={hrefForMovie(movie)}
                    visibleFields={visibleFields}
                    watchLookup={{ scope: 'radarr', instanceId: movie.instanceId, arrId: movie.id }}
                    rating={movie.ratings?.imdb?.value || movie.ratings?.tmdb?.value}
                    instanceLabel={multiInstance ? movie.instanceLabel : undefined}
                    onNavigate={handleNavigateToDetail}
                    imagePriority={startIndex + i < Math.min(posterColumns * 2, 4)}
                    selectable={selectionMode}
                    selected={selectedKeys.has(keyOf(movie))}
                    onToggleSelect={() => toggle(keyOf(movie))}
                    contextActionGroups={contextActionsForMovie(movie)}
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
          const visibleMovies = filtered.slice(startIndex, endIndex);
          const topSpacerHeight = firstRow ? Math.max(0, firstRow.start - contentOffsetTop) : 0;
          const bottomSpacerHeight = lastRow
            ? Math.max(0, overviewVirtualizer.getTotalSize() - (lastRow.end - contentOffsetTop))
            : 0;

          return (
            <div ref={contentRef} className="space-y-2">
              {topSpacerHeight > 0 && <div style={{ height: topSpacerHeight }} />}
              {visibleMovies.map((movie, i) => (
                <MediaOverviewItem
                  key={`${movie.instanceId ?? ''}:${movie.id}`}
                  title={movie.title}
                  year={movie.year}
                  images={movie.images}
                  href={hrefForMovie(movie)}
                  type="movie"
                  monitored={movie.monitored}
                  hasFile={movie.hasFile}
                  status={movie.status}
                  visibleFields={visibleFields}
                  posterSize={posterSize}
                  watchLookup={{ scope: 'radarr', instanceId: movie.instanceId, arrId: movie.id }}
                  qualityProfile={movie.qualityProfileName}
                  studio={movie.studio}
                  certification={movie.certification}
                  overview={movie.overview}
                  rating={movie.ratings?.imdb?.value || movie.ratings?.tmdb?.value}
                  sizeOnDisk={movie.sizeOnDisk}
                  runtime={movie.runtime}
                  genres={movie.genres}
                  instanceLabel={multiInstance ? movie.instanceLabel : undefined}
                  onNavigate={handleNavigateToDetail}
                  imagePriority={startIndex + i < 6}
                  selectable={selectionMode}
                  selected={selectedKeys.has(keyOf(movie))}
                  onToggleSelect={() => toggle(keyOf(movie))}
                  contextActionGroups={contextActionsForMovie(movie)}
                />
              ))}
              {bottomSpacerHeight > 0 && <div style={{ height: bottomSpacerHeight }} />}
            </div>
          );
        }

        return (
          <div ref={contentRef}>
            <MediaTable
              type="movie"
              watchScope="radarr"
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
                studio: 'studio',
                sizeOnDisk: 'sizeOnDisk',
                monitored: 'monitored',
                rating: 'imdbRating',
              }}
              resetPageKey={`${search}|${filter.join(',')}|${instanceFilter}|${watchFilter}|${sort}|${sortDir}`}
            />
          </div>
        );
      })()}

      <RenamePreviewDialog
        open={renameTarget !== null}
        onOpenChange={(open) => { if (!open) setRenameTarget(null); }}
        service="radarr"
        mediaId={renameTarget?.movieId ?? 0}
        mediaTitle={renameTarget?.title ?? ''}
        instanceId={renameTarget?.instanceId}
      />

      <InteractiveSearchDialog
        open={interactiveSearchTarget !== null}
        onOpenChange={(open) => { if (!open) setInteractiveSearchTarget(null); }}
        title={interactiveSearchTarget?.title ?? ''}
        service="radarr"
        searchParams={{
          movieId: interactiveSearchTarget?.movieId ?? 0,
          ...(interactiveSearchTarget?.instanceId
            ? { instanceId: interactiveSearchTarget.instanceId }
            : {}),
        }}
      />

      <SingleMediaDeleteDialog
        key={deleteTarget ? keyOf(deleteTarget) : 'no-delete-target'}
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open && !deletingTarget) setDeleteTarget(null); }}
        title={deleteTarget?.title ?? ''}
        itemNoun="movie"
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
            itemNoun="movie"
          />
        </>
      )}
    </div>
  );
}
