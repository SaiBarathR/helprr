'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ensureArray, jsonFetcher } from '@/lib/query-fetch';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowUpDown,
  BadgeCheck,
  Bell,
  Bookmark,
  ChevronRight,
  Filter,
  ListChecks,
  Loader2,
  MoreHorizontal,
  MoreVertical,
  RefreshCw,
  Plus,
  Search,
  Settings,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import { FadeInImage } from '@/components/media/fade-in-image';
import { BulkActionBar } from '@/components/media/bulk-action-bar';
import { SelectionCheck } from '@/components/media/selection-check';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/media/search-input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import { useCan } from '@/components/permission-provider';
import { useBulkSelection } from '@/lib/use-bulk-selection';
import { reportBulk } from '@/lib/bulk-fan-out';
import { invalidateWatchlistTagCache } from '@/components/watchlist/watchlist-add-dialog';
import { ScheduledAlertDialog } from '@/components/scheduled-alerts/scheduled-alert-dialog';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { QuickContextMenu, type ContextActionGroup } from '@/components/ui/quick-context-menu';
import { useRefreshAction } from '@/lib/hooks/use-refresh-action';
import { cn } from '@/lib/utils';

type MediaType = 'movie' | 'series' | 'anime';
type Source = 'TMDB' | 'TVDB' | 'ANILIST' | 'SONARR' | 'RADARR';

interface WatchlistItem {
  id: string;
  source: Source;
  externalId: string;
  mediaType: MediaType;
  title: string;
  year: number | null;
  posterUrl: string | null;
  overview: string | null;
  rating: number | null;
  addedAt: string;
  href: string | null;
  tags: Array<{ id: string; name: string; color: string | null }>;
}

interface WatchlistTag {
  id: string;
  name: string;
  color: string | null;
  count: number;
}

type SortKey = 'addedAt' | 'title' | 'year' | 'rating';
type SortDir = 'asc' | 'desc';

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'addedAt', label: 'Date Added' },
  { value: 'title', label: 'Title' },
  { value: 'year', label: 'Release Year' },
  { value: 'rating', label: 'Score' },
];

const TYPE_OPTIONS: Array<{ value: 'all' | MediaType; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'movie', label: 'Movies' },
  { value: 'series', label: 'Series' },
  { value: 'anime', label: 'Anime' },
];

const TYPE_SECTION_LABEL: Record<MediaType, string> = {
  movie: 'Movies',
  series: 'Series',
  anime: 'Anime',
};

const SOURCE_OPTIONS: Array<{ value: Source; label: string }> = [
  { value: 'TMDB', label: 'TMDB' },
  { value: 'ANILIST', label: 'AniList' },
  { value: 'TVDB', label: 'TVDB' },
  { value: 'SONARR', label: 'Sonarr' },
  { value: 'RADARR', label: 'Radarr' },
];

// v2: `type` (segmented control) replaced the v1 `mediaTypes` checkbox array.
const STORAGE_KEY = 'helprr.watchlist.view.v2';

interface ViewState {
  sort: SortKey;
  sortDir: SortDir;
  type: 'all' | MediaType;
  sources: Source[];
  libraryOnly: 'all' | 'in' | 'out';
}

const DEFAULT_VIEW: ViewState = {
  sort: 'addedAt',
  sortDir: 'desc',
  type: 'all',
  sources: [],
  libraryOnly: 'all',
};

/** An item is "in library" when its detail page lives in the local library routes. */
function isInLibrary(item: WatchlistItem): boolean {
  return item.href !== null && /^\/(movies|series)\//.test(item.href);
}

function watchlistAddHref(item: WatchlistItem): string | null {
  if (isInLibrary(item)) return null;
  if (item.mediaType === 'movie') {
    const params = new URLSearchParams({ term: item.title });
    if (item.source === 'TMDB') params.set('tmdbId', item.externalId);
    return `/movies/add?${params.toString()}`;
  }
  if (item.mediaType === 'series') {
    const params = new URLSearchParams({ term: item.title, seriesType: 'standard' });
    if (item.source === 'TMDB') params.set('tmdbId', item.externalId);
    if (item.source === 'TVDB') params.set('tvdbId', item.externalId);
    return `/series/add?${params.toString()}`;
  }
  if (item.mediaType === 'anime') {
    const params = new URLSearchParams({ term: item.title });
    return `/series/add?${params.toString()}`;
  }
  return null;
}

function loadView(): ViewState {
  if (typeof window === 'undefined') return DEFAULT_VIEW;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_VIEW;
    const parsed = JSON.parse(raw) as Partial<ViewState>;
    return {
      sort: SORT_OPTIONS.some((o) => o.value === parsed.sort) ? (parsed.sort as SortKey) : DEFAULT_VIEW.sort,
      sortDir: parsed.sortDir === 'asc' || parsed.sortDir === 'desc' ? parsed.sortDir : DEFAULT_VIEW.sortDir,
      type: TYPE_OPTIONS.some((o) => o.value === parsed.type) ? (parsed.type as ViewState['type']) : 'all',
      sources: Array.isArray(parsed.sources)
        ? parsed.sources.filter((s): s is Source => SOURCE_OPTIONS.some((o) => o.value === s))
        : [],
      libraryOnly:
        parsed.libraryOnly === 'in' || parsed.libraryOnly === 'out' ? parsed.libraryOnly : 'all',
    };
  } catch {
    return DEFAULT_VIEW;
  }
}

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// The grid mirrors the discover page's responsive auto-fill minmax + gaps so cards
// grow to fill available width instead of cramming into fixed columns. These helpers
// reproduce that CSS math in JS so the window virtualizer's row geometry stays in sync
// with how the browser actually wraps the cards.
function gridMetrics(viewportWidth: number): { minCard: number; gap: number } {
  let minCard = 122; // base
  let gap = 10; // gap-2.5
  if (viewportWidth >= 640) {
    minCard = 138; // sm
    gap = 14; // gap-3.5
  }
  if (viewportWidth >= 768) gap = 16; // md (gap-4)
  if (viewportWidth >= 1024) minCard = 154; // lg
  if (viewportWidth >= 1280) minCard = 168; // xl
  return { minCard, gap };
}

// For `repeat(auto-fill, minmax(min, 1fr))` the browser fits as many columns as
// satisfy n*min + (n-1)*gap <= width, i.e. floor((width + gap) / (min + gap)).
function columnsForWidth(containerWidth: number, minCard: number, gap: number): number {
  if (containerWidth <= 0) return 1;
  return Math.max(1, Math.floor((containerWidth + gap) / (minCard + gap)));
}

// Height of a virtualized section-header row (label + count + breathing room).
const HEADER_ROW_HEIGHT = 40;

// Cap the "Not in library" rail; "View all" flips the library filter instead.
const RAIL_LIMIT = 20;
const RAIL_CARD =
  'min-w-[110px] w-[110px] sm:min-w-[140px] sm:w-[140px] md:min-w-[150px] md:w-[150px] lg:min-w-[164px] lg:w-[164px] xl:min-w-[180px] xl:w-[180px]';

// The virtualized list mixes section headers with rows of cards.
type VirtualRow =
  | { kind: 'header'; label: string; count: number }
  | { kind: 'cards'; items: WatchlistItem[] };

export default function WatchlistPage() {
  const canEdit = useCan('watchlist.edit');
  const queryClient = useQueryClient();
  const {
    selectionMode,
    selectedKeys,
    toggle,
    selectMany,
    deselectMany,
    enter,
    exit,
  } = useBulkSelection();
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  // Multi-select tag filter (client-side: every item already carries its tags).
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [removeTarget, setRemoveTarget] = useState<WatchlistItem | null>(null);
  const [removing, setRemoving] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  const [view, setView] = useState<ViewState>(DEFAULT_VIEW);
  const [viewLoaded, setViewLoaded] = useState(false);

  // Grid virtualization geometry (window-scrolled, same pattern as movies/series).
  const [viewportWidth, setViewportWidth] = useState(1280);
  const [containerWidth, setContainerWidth] = useState(0);
  const [contentOffsetTop, setContentOffsetTop] = useState(0);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setView(loadView());
    setViewLoaded(true);
  }, []);

  useEffect(() => {
    if (!viewLoaded || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(view));
    } catch {
      // noop
    }
  }, [view, viewLoaded]);

  // The items query key carries the search so changing it refetches; gcTime
  // keeps the list warm for instant back-nav. Tags filter client-side.
  const itemsKey = useMemo(
    () => ['watchlist', 'items', { q: appliedSearch }] as const,
    [appliedSearch],
  );
  const itemsQuery = useQuery({
    queryKey: itemsKey,
    queryFn: jsonFetcher<WatchlistItem[]>(
      `/api/watchlist${appliedSearch
        ? `?${new URLSearchParams({ q: appliedSearch }).toString()}`
        : ''}`,
    ),
    select: ensureArray,
  });
  const items = itemsQuery.data ?? null;
  const error = itemsQuery.isError
    ? itemsQuery.error instanceof Error
      ? itemsQuery.error.message
      : 'Failed to load watchlist'
    : null;

  const tagsQuery = useQuery({
    queryKey: ['watchlist', 'tags'],
    queryFn: jsonFetcher<WatchlistTag[]>('/api/watchlist/tags'),
    select: ensureArray,
  });
  const tags = useMemo(() => tagsQuery.data ?? [], [tagsQuery.data]);

  // Refetch both the items and the tag counts. Drives the toolbar refresh button
  // and the pull-to-refresh gesture.
  const refreshData = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['watchlist'] }),
    [queryClient]
  );
  const { refreshing, refresh } = useRefreshAction(refreshData);

  const debouncedApply = useMemo(
    () =>
      debounce((value: string) => {
        setAppliedSearch(value.trim());
      }, 300),
    []
  );

  useEffect(() => {
    debouncedApply(search);
  }, [search, debouncedApply]);

  async function handleRemove(item: WatchlistItem) {
    setRemoving(true);
    try {
      let res: Response;
      try {
        res = await fetch(`/api/watchlist/${item.id}`, { method: 'DELETE' });
      } catch (err) {
        console.error('[Watchlist] remove network error:', err);
        toast.error('Failed to remove (network error)');
        return;
      }
      if (!res.ok) {
        toast.error('Failed to remove');
        return;
      }
      toast.success('Removed from watchlist');
      // Drop the item from every cached items variant (tag/search filters each
      // have their own key) so it can't reappear when switching filters before
      // the refetch lands.
      queryClient.setQueriesData<WatchlistItem[]>(
        { queryKey: ['watchlist', 'items'] },
        (prev) => (prev ? prev.filter((i) => i.id !== item.id) : prev),
      );
      queryClient.invalidateQueries({ queryKey: ['watchlist', 'tags'] });
    } finally {
      setRemoving(false);
      setRemoveTarget(null);
    }
  }

  async function handleClearAll() {
    setClearingAll(true);
    try {
      let res: Response;
      try {
        res = await fetch('/api/watchlist', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm: 'all' }),
        });
      } catch (err) {
        console.error('[Watchlist] clear-all network error:', err);
        toast.error('Failed to clear watchlist (network error)');
        return;
      }
      if (!res.ok) {
        toast.error('Failed to clear watchlist');
        return;
      }
      const data = (await res.json()) as { count: number };
      toast.success(`Cleared ${data.count} item${data.count === 1 ? '' : 's'}`);
      // Empty every cached items variant, not just the active filter's.
      queryClient.setQueriesData<WatchlistItem[]>({ queryKey: ['watchlist', 'items'] }, () => []);
      queryClient.invalidateQueries({ queryKey: ['watchlist'] });
    } finally {
      setClearingAll(false);
      setClearAllOpen(false);
    }
  }

  // Source + library filters apply before the type split so the segmented
  // control's per-type counts match what selecting a type will show.
  const baseFiltered = useMemo(() => {
    if (!items) return null;
    let list = items;
    if (selectedTagIds.length > 0) {
      const wanted = new Set(selectedTagIds);
      list = list.filter((i) => i.tags.some((t) => wanted.has(t.id)));
    }
    if (view.sources.length > 0) {
      list = list.filter((i) => view.sources.includes(i.source));
    }
    if (view.libraryOnly === 'in') {
      list = list.filter(isInLibrary);
    } else if (view.libraryOnly === 'out') {
      list = list.filter((i) => !isInLibrary(i));
    }

    const cmp = (a: WatchlistItem, b: WatchlistItem): number => {
      let r = 0;
      switch (view.sort) {
        case 'title':
          r = a.title.localeCompare(b.title);
          break;
        case 'year': {
          const ay = a.year ?? -Infinity;
          const by = b.year ?? -Infinity;
          r = ay - by;
          break;
        }
        case 'rating': {
          const ar = a.rating ?? -Infinity;
          const br = b.rating ?? -Infinity;
          r = ar - br;
          break;
        }
        case 'addedAt':
        default:
          r = new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime();
          break;
      }
      return view.sortDir === 'asc' ? r : -r;
    };
    return [...list].sort(cmp);
  }, [items, selectedTagIds, view.sources, view.libraryOnly, view.sort, view.sortDir]);

  const typeCounts = useMemo(() => {
    const counts: Record<MediaType, number> = { movie: 0, series: 0, anime: 0 };
    for (const item of baseFiltered ?? []) counts[item.mediaType]++;
    return counts;
  }, [baseFiltered]);

  const filtered = useMemo(() => {
    if (!baseFiltered) return null;
    if (view.type === 'all') return baseFiltered;
    return baseFiltered.filter((i) => i.mediaType === view.type);
  }, [baseFiltered, view.type]);

  // "Needs action" shelf: watchlisted but not yet in the library. Only shown in
  // the unfiltered All view; "View all" flips the library filter instead of
  // growing the rail unboundedly.
  const notInLibrary = useMemo(
    () => (filtered ?? []).filter((i) => !isInLibrary(i)),
    [filtered]
  );
  const showRail =
    view.type === 'all' &&
    view.libraryOnly === 'all' &&
    !selectionMode &&
    notInLibrary.length > 0;
  const railItems = useMemo(
    () => (showRail ? notInLibrary.slice(0, RAIL_LIMIT) : []),
    [showRail, notInLibrary]
  );

  const filteredIds = useMemo(() => (filtered ?? []).map((i) => i.id), [filtered]);
  const actionableSelectedCount = useMemo(
    () => filteredIds.filter((id) => selectedKeys.has(id)).length,
    [filteredIds, selectedKeys]
  );
  const allFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selectedKeys.has(id));

  useEffect(() => {
    if (!selectionMode) return;
    const offScreen = [...selectedKeys].filter((id) => !filteredIds.includes(id));
    if (offScreen.length > 0) deselectMany(offScreen);
  }, [selectionMode, filteredIds, selectedKeys, deselectMany]);
  const toggleSelectAll = useCallback(() => {
    if (allFilteredSelected) deselectMany(filteredIds);
    else selectMany(filteredIds);
  }, [allFilteredSelected, deselectMany, selectMany, filteredIds]);

  const handleApplyTags = useCallback(
    async (labels: string[], mode: 'add' | 'remove' | 'replace') => {
      const ids = filteredIds.filter((id) => selectedKeys.has(id));
      if (ids.length === 0) return;

      let res: Response;
      try {
        res = await fetch('/api/watchlist/bulk', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids, tags: labels, applyTags: mode }),
        });
      } catch (err) {
        console.error('[Watchlist] bulk tag network error:', err);
        toast.error('Failed to update tags (network error)');
        return;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(typeof err?.error === 'string' ? err.error : 'Failed to update tags');
        return;
      }

      const data = (await res.json()) as { ok: number; fail: number };
      const verb =
        mode === 'replace' ? 'Replaced tags on' : mode === 'add' ? 'Tagged' : 'Untagged';
      reportBulk(verb, data.ok, data.fail, { noun: 'item' });
      invalidateWatchlistTagCache();
      await queryClient.invalidateQueries({ queryKey: ['watchlist'] });
      if (data.fail === 0) exit();
    },
    [filteredIds, selectedKeys, queryClient, exit]
  );

  const handleBulkRemove = useCallback(async () => {
    const ids = filteredIds.filter((id) => selectedKeys.has(id));
    if (ids.length === 0) return;

    let res: Response;
    try {
      res = await fetch('/api/watchlist/bulk', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
    } catch (err) {
      console.error('[Watchlist] bulk remove network error:', err);
      toast.error('Failed to remove (network error)');
      return;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(typeof err?.error === 'string' ? err.error : 'Failed to remove items');
      return;
    }

    const data = (await res.json()) as { ok: number; fail: number };
    reportBulk('Removed', data.ok, data.fail, { noun: 'item' });
    // Optimistically drop the removed items from every cached items variant so
    // they can't reappear when switching filters before the refetch lands.
    const removed = new Set(ids);
    queryClient.setQueriesData<WatchlistItem[]>(
      { queryKey: ['watchlist', 'items'] },
      (prev) => (prev ? prev.filter((i) => !removed.has(i.id)) : prev),
    );
    // Reconcile with the server: invalidate items too (not just tags) so any that
    // failed to delete reappear instead of staying hidden by the optimistic drop.
    queryClient.invalidateQueries({ queryKey: ['watchlist', 'items'] });
    queryClient.invalidateQueries({ queryKey: ['watchlist', 'tags'] });
    // Always leave selection mode so the bulk bar never lingers over a now-empty
    // or stale selection; failures surface via the toast above.
    exit();
  }, [filteredIds, selectedKeys, queryClient, exit]);

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Track the grid's width + page offset so the window virtualizer positions
  // rows correctly. Re-measures when the content above it (tags, rail, filtered
  // set) changes the grid's top.
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
  }, [filtered, tags, showRail]);

  const { minCard, gap } = gridMetrics(viewportWidth);
  // Before the grid is measured, estimate from the viewport so the first paint
  // isn't a single column; the ResizeObserver corrects it with the real width.
  const columns = columnsForWidth(containerWidth > 0 ? containerWidth : viewportWidth, minCard, gap);
  const rowHeight = useMemo(() => {
    if (containerWidth <= 0) return 240;
    const cardWidth = Math.max(1, (containerWidth - gap * (columns - 1)) / columns);
    return cardWidth * 1.5 + gap; // aspect-[2/3] poster + row gap
  }, [containerWidth, columns, gap]);

  // Flatten the grouped sections into virtualizable rows: a header row per
  // labelled section, then its cards chunked by the current column count. The
  // single-type view is one unlabelled section (no header rows).
  const rows = useMemo<VirtualRow[]>(() => {
    if (!filtered || filtered.length === 0) return [];
    const sections: Array<{ label: string | null; items: WatchlistItem[] }> =
      view.type === 'all'
        ? (['movie', 'series', 'anime'] as const)
            .map((t) => ({
              label: TYPE_SECTION_LABEL[t],
              items: filtered.filter((i) => i.mediaType === t),
            }))
            .filter((s) => s.items.length > 0)
        : [{ label: null, items: filtered }];
    // A lone section doesn't need its header — the segmented control already says what it is.
    if (sections.length === 1) sections[0] = { ...sections[0], label: null };

    const out: VirtualRow[] = [];
    for (const section of sections) {
      if (section.label !== null) {
        out.push({ kind: 'header', label: section.label, count: section.items.length });
      }
      for (let i = 0; i < section.items.length; i += columns) {
        out.push({ kind: 'cards', items: section.items.slice(i, i + columns) });
      }
    }
    return out;
  }, [filtered, view.type, columns]);

  const gridVirtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: (i) => (rows[i]?.kind === 'header' ? HEADER_ROW_HEIGHT : rowHeight),
    enabled: rows.length > 0,
    overscan: 3,
    scrollMargin: contentOffsetTop,
  });

  // estimateSize changes (resize, regroup) don't invalidate cached measurements
  // on their own — recompute so spacer math stays in sync with the rows.
  useEffect(() => {
    gridVirtualizer.measure();
  }, [gridVirtualizer, rows, rowHeight]);

  // Eager-load the images the first paint shows: the rail start + first grid row.
  const priorityIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of railItems.slice(0, 4)) ids.add(item.id);
    const firstCards = rows.find((r) => r.kind === 'cards');
    if (firstCards?.kind === 'cards') {
      for (const item of firstCards.items.slice(0, 4)) ids.add(item.id);
    }
    return ids;
  }, [railItems, rows]);

  const visibleTags = tags.filter((t) => t.count > 0);
  const totalCount = items?.length ?? 0;
  const filteredCount = filtered?.length ?? 0;
  const hasActiveFilters =
    view.type !== 'all' || view.sources.length > 0 || view.libraryOnly !== 'all';

  const resetFilters = useCallback(() => {
    setView((v) => ({ ...v, type: 'all', sources: [], libraryOnly: 'all' }));
    setSelectedTagIds([]);
  }, []);

  const activeSortLabel =
    SORT_OPTIONS.find((o) => o.value === view.sort)?.label ?? 'Date Added';

  return (
    <div className="animate-content-in pb-12">
      <PullToRefresh onRefresh={refresh} disabled={selectionMode} />
      <div
        className="page-toolbar page-toolbar-flush space-y-2 app-chrome-bar bg-background/95 pb-2 backdrop-blur supports-[backdrop-filter]:bg-background/80"
      >
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <SearchInput
            value={search}
            onChange={setSearch}
            historyKey="watchlist"
            placeholder="Search watchlist…"
            className="pl-9 pr-9"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors relative"
                aria-label="Filter"
              >
                <Filter className="h-5 w-5" />
                {hasActiveFilters && (
                  <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-primary" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Media type</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={view.type}
                onValueChange={(v) =>
                  setView((prev) => ({ ...prev, type: (v as ViewState['type']) ?? 'all' }))
                }
              >
                {TYPE_OPTIONS.map((opt) => (
                  <DropdownMenuRadioItem
                    key={opt.value}
                    value={opt.value}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {opt.label}
                    {opt.value !== 'all' && (
                      <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                        {typeCounts[opt.value]}
                      </span>
                    )}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Source</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {SOURCE_OPTIONS.map((opt) => (
                <DropdownMenuCheckboxItem
                  key={opt.value}
                  checked={view.sources.includes(opt.value)}
                  onCheckedChange={() =>
                    setView((v) => ({
                      ...v,
                      sources: v.sources.includes(opt.value)
                        ? v.sources.filter((s) => s !== opt.value)
                        : [...v.sources, opt.value],
                    }))
                  }
                  onSelect={(e) => e.preventDefault()}
                >
                  {opt.label}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Library</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={view.libraryOnly}
                onValueChange={(v) =>
                  setView((prev) => ({
                    ...prev,
                    libraryOnly: (v as ViewState['libraryOnly']) ?? 'all',
                  }))
                }
              >
                <DropdownMenuRadioItem value="all" onSelect={(e) => e.preventDefault()}>
                  All
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="in" onSelect={(e) => e.preventDefault()}>
                  In library
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="out" onSelect={(e) => e.preventDefault()}>
                  Not in library
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              {hasActiveFilters && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={resetFilters}>
                    Reset filters
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors"
                aria-label={`Sort: ${activeSortLabel} ${view.sortDir === 'asc' ? 'ascending' : 'descending'}`}
              >
                <ArrowUpDown className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={view.sort}
                onValueChange={(v) =>
                  setView((prev) => ({ ...prev, sort: v as SortKey }))
                }
              >
                {SORT_OPTIONS.map((opt) => (
                  <DropdownMenuRadioItem
                    key={opt.value}
                    value={opt.value}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {opt.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={view.sortDir}
                onValueChange={(v) =>
                  setView((prev) => ({ ...prev, sortDir: v as SortDir }))
                }
              >
                <DropdownMenuRadioItem value="asc" onSelect={(e) => e.preventDefault()}>
                  Ascending
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="desc" onSelect={(e) => e.preventDefault()}>
                  Descending
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {visibleTags.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors relative"
                  aria-label="Filter by tags"
                >
                  <Tag className="h-5 w-5" />
                  {selectedTagIds.length > 0 && (
                    <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-primary" />
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>Tags</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {visibleTags.map((t) => (
                  <DropdownMenuCheckboxItem
                    key={t.id}
                    checked={selectedTagIds.includes(t.id)}
                    onCheckedChange={() =>
                      setSelectedTagIds((prev) =>
                        prev.includes(t.id) ? prev.filter((id) => id !== t.id) : [...prev, t.id]
                      )
                    }
                    onSelect={(e) => e.preventDefault()}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: t.color ?? '#6366f1' }}
                    />
                    <span className="truncate">{t.name}</span>
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                      {t.count}
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
                {selectedTagIds.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setSelectedTagIds([])}>
                      Clear tags
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <div className="text-xs text-muted-foreground ml-auto tabular-nums">
            {filteredCount === totalCount
              ? `${totalCount} item${totalCount === 1 ? '' : 's'}`
              : `${filteredCount} of ${totalCount}`}
          </div>

          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors disabled:opacity-60 disabled:cursor-default"
            aria-label="Refresh watchlist"
          >
            <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
          </button>

          {canEdit && (
            <button
              type="button"
              onClick={() => (selectionMode ? exit() : enter())}
              className={`p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors ${
                selectionMode ? 'bg-primary text-primary-foreground' : 'hover:bg-accent active:bg-accent/80'
              }`}
              aria-label={selectionMode ? 'Exit selection' : 'Select items'}
              aria-pressed={selectionMode}
            >
              <ListChecks className="h-5 w-5" />
            </button>
          )}

          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-primary hover:bg-accent active:bg-accent/80 transition-colors"
                  aria-label="Watchlist actions"
                >
                  <MoreHorizontal className="h-5 w-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={() => setManageOpen(true)}>
                  <Settings className="mr-2 h-4 w-4" />
                  Manage tags
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setClearAllOpen(true)}
                  disabled={totalCount === 0}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Clear watchlist
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

      </div>

      <div className="px-2 md:px-6 mt-3 space-y-3">
        {error && <div className="text-sm text-red-400">{error}</div>}

        {showRail && (
          <section className="space-y-2">
            <div className="flex items-center gap-2 px-0.5">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Not in library
              </h2>
              <span className="text-[11px] text-muted-foreground tabular-nums">{notInLibrary.length}</span>
              {notInLibrary.length > railItems.length && (
                <button
                  type="button"
                  onClick={() => setView((v) => ({ ...v, libraryOnly: 'out' }))}
                  className="ml-auto inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
                >
                  View all
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="-mx-2 flex gap-2.5 overflow-x-auto px-2 pb-1 scrollbar-hide md:-mx-6 md:px-6">
              {railItems.map((item, i) => (
                <div key={item.id} className={cn('shrink-0', RAIL_CARD)}>
                  <WatchlistCard
                    item={item}
                    imagePriority={priorityIds.has(item.id) && i < 4}
                    onSelect={() => {
                      enter();
                      toggle(item.id);
                    }}
                    onRemove={() => setRemoveTarget(item)}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {filtered === null ? (
          itemsQuery.isLoading ? (
            <div className="py-16 text-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mx-auto" />
            </div>
          ) : null
        ) : filtered.length === 0 ? (
          totalCount === 0 ? (
            <div className="py-16 text-center text-muted-foreground space-y-1">
              <Bookmark className="h-8 w-8 mx-auto opacity-60" />
              <p className="text-sm">Your watchlist is empty.</p>
              <p className="text-xs">
                Open any item in Discover, Anime, Movies, or Series to add it here.
              </p>
            </div>
          ) : (
            <div className="py-16 text-center text-muted-foreground space-y-2">
              <Filter className="h-8 w-8 mx-auto opacity-60" />
              <p className="text-sm">No items match the current filters.</p>
              <Button variant="outline" size="sm" onClick={resetFilters}>
                Reset filters
              </Button>
            </div>
          )
        ) : (
          (() => {
            const virtualRows = gridVirtualizer.getVirtualItems();
            const firstRow = virtualRows[0];
            const lastRow = virtualRows[virtualRows.length - 1];
            const topSpacer = firstRow ? Math.max(0, firstRow.start - contentOffsetTop) : 0;
            const bottomSpacer = lastRow
              ? Math.max(0, gridVirtualizer.getTotalSize() - (lastRow.end - contentOffsetTop))
              : 0;
            return (
              <div ref={contentRef}>
                {topSpacer > 0 && <div style={{ height: topSpacer }} />}
                {virtualRows.map((vr) => {
                  const row = rows[vr.index];
                  if (!row) return null;
                  if (row.kind === 'header') {
                    return (
                      <div
                        key={vr.key}
                        style={{ height: HEADER_ROW_HEIGHT }}
                        className="flex items-end gap-2 px-0.5 pb-2"
                      >
                        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground leading-none">
                          {row.label}
                        </h2>
                        <span className="text-[11px] text-muted-foreground tabular-nums leading-none">
                          {row.count}
                        </span>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={vr.key}
                      className="grid"
                      style={{
                        height: rowHeight,
                        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                        columnGap: gap,
                      }}
                    >
                      {row.items.map((item) => (
                        <div key={item.id} className="self-start">
                          <WatchlistCard
                            item={item}
                            imagePriority={priorityIds.has(item.id)}
                            selectable={selectionMode}
                            selected={selectedKeys.has(item.id)}
                            onToggleSelect={() => toggle(item.id)}
                            onSelect={() => {
                              enter();
                              toggle(item.id);
                            }}
                            onRemove={() => setRemoveTarget(item)}
                          />
                        </div>
                      ))}
                    </div>
                  );
                })}
                {bottomSpacer > 0 && <div style={{ height: bottomSpacer }} />}
              </div>
            );
          })()
        )}
      </div>

      {canEdit && (
        <ConfirmDialog
          open={removeTarget !== null}
          onOpenChange={(o) => {
            if (!o) setRemoveTarget(null);
          }}
          title={removeTarget ? `Remove "${removeTarget.title}"?` : 'Remove?'}
          description="This won't affect your media library — only the watchlist entry."
          confirmLabel="Remove"
          destructive
          busy={removing}
          onConfirm={() => (removeTarget ? handleRemove(removeTarget) : Promise.resolve())}
        />
      )}

      <ConfirmDialog
        open={clearAllOpen}
        onOpenChange={setClearAllOpen}
        title="Clear entire watchlist?"
        description={`This will remove all ${totalCount} item${totalCount === 1 ? '' : 's'} from your watchlist. Your media library is not affected.`}
        confirmLabel="Clear all"
        destructive
        busy={clearingAll}
        onConfirm={handleClearAll}
      />

      <ManageTagsDialog
        open={manageOpen}
        onOpenChange={(o) => {
          setManageOpen(o);
          if (!o) {
            queryClient.invalidateQueries({ queryKey: ['watchlist'] });
          }
        }}
        tags={tags}
      />

      {selectionMode && canEdit && (
        <>
          <div aria-hidden className="h-24" />
          <BulkActionBar
            count={actionableSelectedCount}
            allSelected={allFilteredSelected}
            onToggleSelectAll={toggleSelectAll}
            onCancel={exit}
            variant="full"
            canTag
            canSearch={false}
            onSearch={async () => {}}
            canDelete
            onDelete={() => handleBulkRemove()}
            deleteFilesOption={false}
            deleteVerb="Remove"
            deleteDescription="Removes the selected items from your watchlist. Your media library is not affected."
            allowReplace
            tags={tags.map((t) => ({ id: 0, label: t.name }))}
            onApplyTags={handleApplyTags}
            itemNoun="item"
          />
        </>
      )}
    </div>
  );
}

function WatchlistCard({
  item,
  imagePriority,
  selectable,
  selected,
  onToggleSelect,
  onSelect,
  onRemove,
}: {
  item: WatchlistItem;
  imagePriority?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onSelect?: () => void;
  onRemove: () => void;
}) {
  const canEdit = useCan('watchlist.edit');
  const canSchedule = useCan('scheduledAlerts.edit');
  const canAddMovies = useCan('movies.add');
  const canAddSeries = useCan('series.add');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const inLibrary = isInLibrary(item);
  const addHref = watchlistAddHref(item);
  const canAdd = (item.mediaType === 'movie' && canAddMovies) || (item.mediaType !== 'movie' && canAddSeries);
  const poster = item.posterUrl
    ? (toCachedImageSrc(
        item.posterUrl,
        item.source === 'TMDB'
          ? 'tmdb'
          : item.source === 'ANILIST'
          ? 'anilist'
          : item.source === 'SONARR'
          ? 'sonarr'
          : item.source === 'RADARR'
          ? 'radarr'
          : undefined
      ) ?? item.posterUrl)
    : null;
  const contextGroups: ContextActionGroup[] = [
    {
      id: 'navigation',
      actions: [
        ...(item.href
          ? [{
              id: inLibrary ? 'library' : 'open',
              label: inLibrary ? 'Open in library' : 'Open details',
              icon: inLibrary ? <BadgeCheck className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />,
              href: item.href,
            }]
          : []),
        ...(addHref && canAdd
          ? [{
              id: 'add',
              label: `Add to ${item.mediaType === 'movie' ? 'Radarr' : 'Sonarr'}`,
              icon: <Plus className="h-4 w-4" />,
              href: addHref,
            }]
          : []),
      ],
    },
    {
      id: 'actions',
      actions: [
        ...(canEdit && onSelect
          ? [{
              id: 'select',
              label: 'Select',
              icon: <ListChecks className="h-4 w-4" />,
              onSelect,
            }]
          : []),
        ...(canEdit
          ? [{
              id: 'remove',
              label: 'Remove from watchlist',
              icon: <Trash2 className="h-4 w-4" />,
              onSelect: onRemove,
              destructive: true,
            }]
          : []),
      ],
    },
  ];
  const posterCore = (
    <div
      className={cn(
        'relative aspect-[2/3] rounded-xl overflow-hidden border border-border/40 bg-muted',
        selectable && selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
      )}
    >
      {poster ? (
        <FadeInImage
          src={poster}
          alt={item.title}
          fill
          sizes="(max-width: 640px) 33vw, (max-width: 1200px) 18vw, 170px"
          priority={imagePriority}
          className="object-cover transition-transform duration-300 group-hover:scale-105"
          unoptimized={isProtectedApiImageSrc(poster)}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <Bookmark className="h-8 w-8" />
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 p-2">
        <p className="text-xs font-semibold text-white truncate leading-tight">{item.title}</p>
        <div className="flex items-center gap-1.5 text-[10px] text-white/75">
          {item.year !== null && <span>{item.year}</span>}
          {item.rating !== null && (
            <span className="tabular-nums">★ {(item.rating / 10).toFixed(1)}</span>
          )}
          {inLibrary && (
            <BadgeCheck aria-label="In library" className="h-3 w-3 text-emerald-400" />
          )}
        </div>
      </div>
      {item.tags.length > 0 && (
        <div className="absolute top-1.5 right-1.5 flex flex-wrap gap-1 max-w-[70%] justify-end">
          {item.tags.slice(0, 2).map((t) => (
            <span
              key={t.id}
              className="rounded-full px-1.5 py-0.5 text-[9px] font-medium"
              style={{
                backgroundColor: `${t.color ?? '#6366f1'}cc`,
                color: '#fff',
              }}
            >
              {t.name}
            </span>
          ))}
          {item.tags.length > 2 && (
            <span className="rounded-full bg-black/55 px-1.5 py-0.5 text-[9px] text-white">
              +{item.tags.length - 2}
            </span>
          )}
        </div>
      )}
    </div>
  );

  if (selectable) {
    return (
      <div className="group relative">
        <button
          type="button"
          onClick={onToggleSelect}
          aria-pressed={Boolean(selected)}
          aria-label={`${selected ? 'Deselect' : 'Select'} ${item.title}`}
          className="block w-full text-left rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {posterCore}
        </button>
        <div className="absolute top-1.5 left-1.5 z-10 pointer-events-none">
          <SelectionCheck selected={Boolean(selected)} />
        </div>
      </div>
    );
  }

  // The action controls live as a SIBLING of the <Link>, not inside it. Radix
  // portals the menu/dialog to <body>, but React events still bubble through the
  // React tree — so if these were descendants of the Link, every click inside the
  // menu or dialog would bubble to the Link's onClick and navigate to the detail
  // page. Kept as a sibling overlay, their clicks never reach the Link.
  const actions = (canSchedule || canEdit) && (
    <div className="absolute top-1.5 left-1.5 z-10">
      {/* Mobile: one compact menu so the small poster isn't crowded with icons. */}
      <div className="md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Item actions"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm hover:bg-black/70 text-white"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            {canSchedule && (
              <DropdownMenuItem onClick={() => setScheduleOpen(true)}>
                <Bell className="mr-2 h-4 w-4" />
                Schedule alert
              </DropdownMenuItem>
            )}
            {canEdit && (
              <DropdownMenuItem variant="destructive" onClick={() => onRemove()}>
                <Trash2 className="mr-2 h-4 w-4" />
                Remove
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {/* Desktop: individual icons on the poster, as before. */}
      <div className="hidden md:flex items-center gap-1.5">
        {canSchedule && (
          <button
            type="button"
            onClick={() => setScheduleOpen(true)}
            aria-label="Schedule alert"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-black/45 backdrop-blur-md text-white hover:bg-black/60 transition-colors"
          >
            <Bell className="h-3.5 w-3.5" />
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={() => onRemove()}
            aria-label="Remove from watchlist"
            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/55 backdrop-blur-sm hover:bg-black/70 text-white"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="group relative">
      {item.href ? (
        <QuickContextMenu label={`${item.title} actions`} groups={contextGroups}>
          <Link href={item.href} className="block">
            {posterCore}
          </Link>
        </QuickContextMenu>
      ) : (
        <QuickContextMenu label={`${item.title} actions`} groups={contextGroups}>
          <div className="block">{posterCore}</div>
        </QuickContextMenu>
      )}
      {actions}
      {canSchedule && (
        <ScheduledAlertDialog
          open={scheduleOpen}
          onOpenChange={setScheduleOpen}
          draft={{
            source: item.source,
            externalId: item.externalId,
            mediaType: item.mediaType,
            title: item.title,
            year: item.year,
            posterUrl: item.posterUrl,
            overview: item.overview,
            rating: item.rating,
            href: item.href,
          }}
        />
      )}
    </div>
  );
}

function ManageTagsDialog({
  open,
  onOpenChange,
  tags,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tags: WatchlistTag[];
}) {
  const [edits, setEdits] = useState<Record<string, { name: string; color: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setEdits({});
      return;
    }
    const initial: Record<string, { name: string; color: string }> = {};
    for (const t of tags) {
      initial[t.id] = { name: t.name, color: t.color ?? '#6366f1' };
    }
    setEdits(initial);
  }, [open, tags]);

  async function save(t: WatchlistTag) {
    const next = edits[t.id];
    if (!next) return;
    const nameChanged = next.name !== t.name;
    const colorChanged = next.color !== (t.color ?? '#6366f1');
    if (!nameChanged && !colorChanged) return;
    setSaving(t.id);
    try {
      let res: Response;
      try {
        res = await fetch(`/api/watchlist/tags/${t.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(nameChanged ? { name: next.name } : {}),
            ...(colorChanged ? { color: next.color } : {}),
          }),
        });
      } catch (err) {
        console.error('[Watchlist] tag-rename network error:', err);
        toast.error('Failed to update tag (network error)');
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err?.error ?? 'Failed to update tag');
        return;
      }
      toast.success('Tag updated');
    } finally {
      setSaving(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage tags</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          {tags.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tags yet. Add items with tags to create them.</p>
          ) : (
            tags.map((t) => {
              const draft = edits[t.id] ?? { name: t.name, color: t.color ?? '#6366f1' };
              return (
                <div key={t.id} className="flex items-center gap-2">
                  <input
                    type="color"
                    value={draft.color}
                    onChange={(e) =>
                      setEdits((prev) => ({ ...prev, [t.id]: { ...draft, color: e.target.value } }))
                    }
                    className="h-9 w-9 rounded border border-border bg-background cursor-pointer"
                    aria-label="Tag color"
                  />
                  <Input
                    value={draft.name}
                    onChange={(e) =>
                      setEdits((prev) => ({ ...prev, [t.id]: { ...draft, name: e.target.value } }))
                    }
                    className="flex-1"
                  />
                  <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">
                    {t.count}
                  </span>
                  <Button size="sm" onClick={() => save(t)} disabled={saving === t.id}>
                    {saving === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                  </Button>
                </div>
              );
            })
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
