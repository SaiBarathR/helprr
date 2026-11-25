'use client';

import { useRouteViewState } from '@/lib/hooks/use-route-view-state';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToolbarHeight } from '@/lib/hooks/use-toolbar-height';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ActiveFilterBar, multiSelectFilters, searchFilter, type ActiveFilter } from '@/components/ui/active-filter-bar';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { reportBulkTorrent } from '@/lib/bulk-fan-out';
import { ListSkeleton } from '@/components/ui/list-skeleton';
import { DataTable } from '@/components/ui/data-table';
import type { QBittorrentTorrent } from '@/types';
import { useUIStore, type TorrentsSortKeyPreference as SortKey } from '@/lib/store';
import { useCan } from '@/components/permission-provider';
import { useBadgeActions } from '@/components/layout/badge-provider';
import { setSpeedLimitTargets } from './_components/speed-limit-targets';
import { setOrganizeTargets } from './_components/organize-targets';
import { torrentsEmptyMessage } from './_components/empty-message';
import {
  OPTIMISTIC_OVERRIDE_FIELD,
  OPTIMISTIC_ROW_PATCHES,
  OPTIMISTIC_STATE_TTL_MS,
  TORRENT_FACETS,
  TORRENT_ROW_HEIGHT,
  compareTorrents,
  filterOptions,
  matchesTorrentFacets,
  matchesTorrentFilter,
  torrentActionMessage,
  torrentFacetOptions,
  type TorrentFacetFilters,
} from './_components/torrent-list';
import { TorrentRow, selectionAllowed } from './_components/torrent-row';
import { useTorrentsSummary } from './_components/use-torrents-summary';
import { useTorrentTable } from './_components/use-torrent-table';
import { TorrentColumnPicker } from './_components/torrent-column-picker';
import { TorrentsToolbar, type TorrentFacetGroup } from './_components/torrents-toolbar';
import { TorrentsBulkBar } from './_components/torrents-bulk-bar';
import { TorrentDetailDrawer, type TorrentDetailData } from './_components/torrent-detail-drawer';
import { TorrentDeleteDrawer } from './_components/torrent-delete-drawer';
import { TorrentCategoryDrawer, clearCategoryDrawerReturn, peekCategoryDrawerReturn, type CategoryDrawerState } from './_components/torrent-category-drawer';
import { PageTitle } from '@/components/layout/page-title';
import { withInstanceQuery } from '@/lib/query-fetch';
import { qbitInstanceKey, useQbitInstance } from './_components/use-qbit-instance';


type CategoryList = Record<string, { name: string; savePath: string }>;

/** qBittorrent's categories (null when it refused); offline, the ones the loaded torrents name. */
async function fetchCategories(torrents: QBittorrentTorrent[], instanceId: string | undefined): Promise<CategoryList | null> {
  try {
    // Fetch categories via a dedicated endpoint call
    const res = await fetch(withInstanceQuery('/api/qbittorrent/categories', instanceId));
    return res.ok ? await res.json() : null;
  } catch {
    // Fallback: extract unique categories from loaded torrents
    const cats: CategoryList = {};
    torrents.forEach((t) => {
      if (t.category) cats[t.category] = { name: t.category, savePath: '' };
    });
    return cats;
  }
}

// --- Main page ---

export default function TorrentsPage() {
  const qbit = useQbitInstance();
  // One qBittorrent at a time. Remounted on a switch, so nothing on screen
  // (the list, a selection, an open drawer, an optimistic change) carries over
  // from one instance to another; an action still on its way keeps the
  // instance it was sent to.
  return <TorrentsView key={qbitInstanceKey(qbit.instanceId)} qbit={qbit} />;
}

function TorrentsView({ qbit }: { qbit: ReturnType<typeof useQbitInstance> }) {
  const { instanceId } = qbit;
  const { toolbarRef, toolbarStyle } = useToolbarHeight();
  const router = useRouter();
  const { adjustBadge } = useBadgeActions();
  const canManageTorrents = useCan('torrents.manage');
  const canDeleteTorrents = useCan('torrents.delete');
  const canBandwidthTorrents = useCan('torrents.bandwidth');
  const canSelectTorrents = selectionAllowed(canManageTorrents, canDeleteTorrents, canBandwidthTorrents);
  const canAddTorrents = useCan('torrents.add');
  const canViewLinked = useCan('activity.view');
  const hasHydrated = useUIStore((s) => s.hasHydrated);
  const filter = useUIStore((s) => s.torrentsFilter);
  const setFilter = useUIStore((s) => s.setTorrentsFilter);
  const categoryFilter = useUIStore((s) => s.torrentsCategoryFilter);
  const setCategoryFilter = useUIStore((s) => s.setTorrentsCategoryFilter);
  const tagFilter = useUIStore((s) => s.torrentsTagFilter);
  const setTagFilter = useUIStore((s) => s.setTorrentsTagFilter);
  const trackerFilter = useUIStore((s) => s.torrentsTrackerFilter);
  const setTrackerFilter = useUIStore((s) => s.setTorrentsTrackerFilter);
  const facetFilters = useMemo<TorrentFacetFilters>(
    () => ({ categories: categoryFilter, tags: tagFilter, trackers: trackerFilter }),
    [categoryFilter, tagFilter, trackerFilter],
  );
  const sortKey = useUIStore((s) => s.torrentsSortKey);
  const setSortKey = useUIStore((s) => s.setTorrentsSortKey);
  const sortDir = useUIStore((s) => s.torrentsSortDir);
  const setSortDir = useUIStore((s) => s.setTorrentsSortDir);
  const viewMode = useUIStore((s) => s.torrentsView);
  // 'auto' picks the table from Tailwind's lg breakpoint up.
  const isBelowLg = useIsMobile(1023);
  const isTableView = viewMode === 'table' || (viewMode === 'auto' && !isBelowLg);
  const tableColumnChoice = useUIStore((s) => s.torrentsTableColumns);
  const setTableColumnChoice = useUIStore((s) => s.setTorrentsTableColumns);
  const [search, setSearch] = useRouteViewState('search', '');
  // Back from New category, opened in the category drawer: that drawer again,
  // for the same torrents (still selected), with the new category listed.
  const [categoryReturn] = useState(peekCategoryDrawerReturn);
  const [selectedTorrents, setSelectedTorrents] = useState<Set<string>>(
    () => new Set(categoryReturn?.bulk ? categoryReturn.hash.split('|') : []),
  );
  const [listOffsetTop, setListOffsetTop] = useState(0);

  const [detailHash, setDetailHash] = useState<string | null>(null);
  // Mirrors detailHash so an in-flight detail fetch can tell it was superseded
  // (another torrent opened, or the drawer closed) and drop its response.
  const detailHashRef = useRef<string | null>(null);
  const detailAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => detailAbortRef.current?.abort(), []);
  const [detailData, setDetailData] = useState<TorrentDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  useEffect(() => {
    detailHashRef.current = detailHash;
    if (!detailHash) detailAbortRef.current?.abort();
  }, [detailHash]);

  const [deleteDrawer, setDeleteDrawer] = useState<{ open: boolean; hash: string; name: string; deleteFiles: boolean }>({
    open: false,
    hash: '',
    name: '',
    deleteFiles: false,
  });
  const [deleting, setDeleting] = useState(false);

  // Category drawer
  const [categoryDrawer, setCategoryDrawer] = useState<CategoryDrawerState>(
    () => (categoryReturn ? { open: true, ...categoryReturn } : { open: false, hash: '' }),
  );
  const [categories, setCategories] = useState<CategoryList>({});
  const [categoriesLoading, setCategoriesLoading] = useState(categoryReturn !== null);

  const {
    torrents,
    setTorrents,
    transferInfo,
    speedLimitsMode,
    setSpeedLimitsMode,
    refetchSummary,
    pendingFieldRef,
    pendingDeleteRef,
    pendingSpeedModeRef,
    torrentsRef,
    loading,
    refreshing,
    refresh,
    error,
    offline,
  } = useTorrentsSummary(filter, hasHydrated, instanceId);

  const listRef = useRef<HTMLDivElement | null>(null);

  const fetchDetail = useCallback(async (hash: string) => {
    detailAbortRef.current?.abort();
    const controller = new AbortController();
    detailAbortRef.current = controller;
    setDetailHash(hash);
    detailHashRef.current = hash;
    setDetailLoading(true);
    setDetailData(null);
    try {
      const res = await fetch(withInstanceQuery(`/api/qbittorrent/${hash}/details`, instanceId), { signal: controller.signal });
      // Superseded (another torrent opened) or drawer closed while in flight:
      // this response no longer owns the drawer state.
      if (controller.signal.aborted || detailHashRef.current !== hash) return;
      if (res.ok) {
        const details = await res.json();
        if (!controller.signal.aborted && detailHashRef.current === hash) setDetailData(details);
      } else {
        toast.error('Failed to load torrent details');
      }
    } catch {
      if (!controller.signal.aborted && detailHashRef.current === hash) toast.error('Failed to load torrent details');
    } finally {
      if (detailHashRef.current === hash) setDetailLoading(false);
    }
  }, [instanceId]);

  // A selection brought back from New category waits for the first loaded
  // list (even an empty one): the placeholder before it would drop every hash.
  const [unloadedTorrents] = useState(torrents);
  useEffect(() => {
    if (torrents === unloadedTorrents) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- prune selected hashes when refreshed torrent data no longer contains them
    setSelectedTorrents((prev) => {
      if (prev.size === 0) return prev;
      const availableHashes = new Set(torrents.map((torrent) => torrent.hash));
      const next = new Set(Array.from(prev).filter((hash) => availableHashes.has(hash)));
      return next.size === prev.size ? prev : next;
    });
  }, [torrents, unloadedTorrents]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const measure = () => {
      const rect = list.getBoundingClientRect();
      setListOffsetTop(rect.top + window.scrollY);
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(list);
    window.addEventListener('resize', measure);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
    // isTableView: switching views remounts the measured node, so re-attach.
  }, [selectedTorrents.size, loading, error, torrents.length, search, filter, facetFilters, isTableView]);

  const torrentAction = useCallback(async (
    hash: string,
    action: string,
    extra?: Record<string, unknown>,
    opts?: { silent?: boolean },
  ): Promise<boolean | 'gone'> => {
    // Optimistically patch the touched rows so the UI reacts instantly; the
    // patched field is also registered as a pending override (deletes as
    // tombstones) so a poll racing the action can't revert the rows.
    const patchRow = OPTIMISTIC_ROW_PATCHES[action];
    const hashes = new Set(hash.split('|'));
    let snapshot: QBittorrentTorrent[] | null = null;
    if (patchRow || action === 'delete') {
      snapshot = torrentsRef.current;
      const until = Date.now() + OPTIMISTIC_STATE_TTL_MS;
      if (action === 'delete') {
        for (const h of hashes) pendingDeleteRef.current.set(h, until);
      } else {
        const field = OPTIMISTIC_OVERRIDE_FIELD[action];
        if (field) {
          for (const t of snapshot) {
            if (!hashes.has(t.hash)) continue;
            const next = patchRow!(t, extra);
            if (next[field] !== t[field]) {
              pendingFieldRef.current.set(t.hash, { field, value: next[field], prev: t[field], until });
            }
          }
        }
      }
      setTorrents((prev) =>
        action === 'delete'
          ? prev.filter((t) => !hashes.has(t.hash))
          : prev.map((t) => (hashes.has(t.hash) ? patchRow!(t, extra) : t)),
      );
    }
    try {
      const res = await fetch(withInstanceQuery('/api/qbittorrent', instanceId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash, action, ...extra }),
      });
      let alreadyGone = false;
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // A delete of torrents qBittorrent no longer has: they are gone, as asked.
        if (action === 'delete' && res.status === 404 && data.gone === true) alreadyGone = true;
        else throw new Error(data.error || 'Action failed');
      }
      if (!opts?.silent) {
        if (alreadyGone) toast.info(hashes.size === 1 ? 'It was already gone from qBittorrent' : 'They were already gone from qBittorrent');
        else toast.success(torrentActionMessage(action, 'single'));
      }
      setTimeout(() => {
        void refetchSummary();
      }, 500);
      return alreadyGone ? 'gone' : true;
    } catch (err) {
      // Roll back only the touched rows: a wholesale snapshot restore would
      // clobber poll updates and other optimistic actions that landed in flight.
      if (snapshot) {
        const snapByHash = new Map(snapshot.map((t) => [t.hash, t]));
        if (action === 'delete') {
          for (const h of hashes) pendingDeleteRef.current.delete(h);
          setTorrents((prev) => {
            const have = new Set(prev.map((t) => t.hash));
            const restored = snapshot!.filter((t) => hashes.has(t.hash) && !have.has(t.hash));
            // Order doesn't matter: the visible list is re-sorted by sortKey.
            return restored.length > 0 ? [...prev, ...restored] : prev;
          });
        } else {
          for (const h of hashes) pendingFieldRef.current.delete(h);
          setTorrents((prev) =>
            prev.map((t) => (hashes.has(t.hash) && snapByHash.has(t.hash) ? snapByHash.get(t.hash)! : t)),
          );
        }
      }
      if (!opts?.silent) toast.error(err instanceof Error ? err.message : 'Action failed');
      return false;
    }
  }, [instanceId, refetchSummary, pendingDeleteRef, pendingFieldRef, setTorrents, torrentsRef]);

  // `targets`: the torrents a drawer opened on, which a poll pruning the selection must not change.
  const bulkAction = useCallback(async (action: string, extra?: Record<string, unknown>, targets?: string[]): Promise<boolean> => {
    const list = targets ?? Array.from(selectedTorrents);
    if (list.length === 0) return false;
    const count = list.length;
    const hashes = list.join('|');
    const verb = torrentActionMessage(action, 'bulk');
    const ok = (await torrentAction(hashes, action, extra, { silent: true })) !== false;
    if (ok) {
      reportBulkTorrent(verb, count, 0);
      setSelectedTorrents(new Set());
    } else {
      reportBulkTorrent(verb, 0, count);
    }
    return ok;
  }, [selectedTorrents, torrentAction]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    // Capture each removed torrent's badge contribution before the rows vanish:
    // in-flight (progress < 1) counts toward the total, stalled/errored toward
    // attention. deleteDrawer.hash is one hash or several joined with '|'.
    const hashes = new Set(deleteDrawer.hash.split('|'));
    let inFlight = 0;
    let attention = 0;
    for (const torrent of torrents) {
      if (!hashes.has(torrent.hash)) continue;
      // attention is a subset of in-flight, matching the poll's badge definition.
      if (torrent.progress < 1) {
        inFlight++;
        if (torrent.state === 'error' || torrent.state === 'missingFiles' || torrent.state === 'stalledDL') {
          attention++;
        }
      }
    }
    try {
      const ok = await torrentAction(deleteDrawer.hash, 'delete', { deleteFiles: deleteDrawer.deleteFiles });
      // Only adjust the badge / close the drawer when the delete actually succeeded.
      if (ok) {
        // Torrents already gone had already left the badge.
        if (ok !== 'gone' && (inFlight || attention)) adjustBadge('downloads', -inFlight, -attention);
        setDeleteDrawer({ open: false, hash: '', name: '', deleteFiles: false });
      }
    } finally {
      setDeleting(false);
    }
  }, [deleteDrawer.deleteFiles, deleteDrawer.hash, torrentAction, torrents, adjustBadge]);

  const toggleSelect = useCallback((hash: string) => {
    setSelectedTorrents((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) {
        next.delete(hash);
      } else {
        next.add(hash);
      }
      return next;
    });
  }, []);

  const openDeleteDrawer = useCallback((hash: string, name: string, deleteFiles: boolean) => {
    setDeleteDrawer({ open: true, hash, name, deleteFiles });
  }, []);

  const showCategories = useCallback((loaded: CategoryList | null) => {
    if (loaded) setCategories(loaded);
    setCategoriesLoading(false);
  }, []);

  const openCategoryDrawer = useCallback((hash: string, bulk?: boolean) => {
    setCategoryDrawer({ open: true, hash, bulk });
    setCategoriesLoading(true);
    void fetchCategories(torrentsRef.current, instanceId).then(showCategories);
  }, [instanceId, showCategories, torrentsRef]);

  // Taken once the page is up, so a later visit doesn't open the drawer again.
  useEffect(() => {
    if (!categoryReturn) return;
    clearCategoryDrawerReturn();
    void fetchCategories(torrentsRef.current, instanceId).then(showCategories);
  }, [categoryReturn, instanceId, showCategories, torrentsRef]);

  const openBulkCategory = useCallback(() => {
    void openCategoryDrawer(Array.from(selectedTorrents).join('|'), true);
  }, [openCategoryDrawer, selectedTorrents]);

  // A pick from the selection goes as one bulk action: one toast, and the selection clears.
  const pickCategory = useCallback((category: string) => (
    categoryDrawer.bulk
      ? bulkAction('setCategory', { category }, categoryDrawer.hash.split('|'))
      : torrentAction(categoryDrawer.hash, 'setCategory', { category })
  ), [bulkAction, categoryDrawer.bulk, categoryDrawer.hash, torrentAction]);

  // Renaming and bulk limits are pages, not drawers: their text fields would
  // bring up the on-screen keyboard, which pushes a drawer out of view on iOS.
  const openRename = useCallback((hash: string) => {
    router.push(`/torrents/${hash}/rename`);
  }, [router]);

  const openBulkSpeedLimits = useCallback(() => {
    setSpeedLimitTargets(torrents
      .filter((t) => selectedTorrents.has(t.hash))
      .map(({
        hash, name, dl_limit, up_limit, ratio_limit, seeding_time_limit, inactive_seeding_time_limit,
        max_ratio, max_seeding_time, max_inactive_seeding_time,
      }) => ({
        hash, name, dl_limit, up_limit, ratio_limit, seeding_time_limit, inactive_seeding_time_limit,
        max_ratio, max_seeding_time, max_inactive_seeding_time,
      })));
    router.push('/torrents/speed-limits');
  }, [router, selectedTorrents, torrents]);

  const openOrganize = useCallback(() => {
    setOrganizeTargets(torrents
      .filter((t) => selectedTorrents.has(t.hash))
      .map(({ hash, name, save_path, tags }) => ({ hash, name, save_path, tags })));
    router.push('/torrents/organize');
  }, [router, selectedTorrents, torrents]);

  const toggleAltSpeedMode = useCallback(async () => {
    // Optimistic flip with a pending override so a racing poll can't bounce the
    // toggle; the captured pre-action value (not a blind re-flip, which could
    // land on the wrong side after a poll repaint) is restored on failure.
    const prev = speedLimitsMode;
    const next = prev === 1 ? 0 : 1;
    pendingSpeedModeRef.current = { value: next, prev, until: Date.now() + OPTIMISTIC_STATE_TTL_MS };
    setSpeedLimitsMode(next);
    try {
      const res = await fetch(withInstanceQuery('/api/qbittorrent/transfer/limits', instanceId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggleSpeedLimitsMode' }),
      });
      if (!res.ok) throw new Error('Failed');
      toast.success('Alternative speed mode toggled');
      setTimeout(() => void refetchSummary(), 300);
    } catch {
      pendingSpeedModeRef.current = null;
      setSpeedLimitsMode(prev);
      toast.error('Failed to toggle speed mode');
    }
  }, [instanceId, refetchSummary, speedLimitsMode, pendingSpeedModeRef, setSpeedLimitsMode]);

  const filteredTorrents = useMemo(() => {
    const q = search.trim().toLowerCase();
    let filtered = q ? torrents.filter((torrent) => torrent.name.toLowerCase().includes(q)) : [...torrents];
    if (filter.length > 0) {
      filtered = filtered.filter((t) => filter.some((f) => matchesTorrentFilter(t, f)));
    }
    if (facetFilters.categories.length > 0 || facetFilters.tags.length > 0 || facetFilters.trackers.length > 0) {
      filtered = filtered.filter((t) => matchesTorrentFacets(t, facetFilters));
    }
    filtered.sort((a, b) => {
      const cmp = compareTorrents(a, b, sortKey);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return filtered;
  }, [search, torrents, filter, facetFilters, sortKey, sortDir]);

  // Cards stay window-virtualized; the table paginates instead (DataTable).
  const useVirtualization = !loading && filteredTorrents.length > 0 && !isTableView;
  const virtualizer = useWindowVirtualizer({
    count: filteredTorrents.length,
    estimateSize: () => TORRENT_ROW_HEIGHT,
    enabled: useVirtualization,
    overscan: 8,
    scrollMargin: listOffsetTop,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const firstVirtualRow = virtualRows[0];
  const lastVirtualRow = virtualRows[virtualRows.length - 1];
  const startIndex = firstVirtualRow?.index ?? 0;
  const endIndex = (lastVirtualRow?.index ?? 0) + 1;

  const visibleTorrents = useMemo(() => {
    return filteredTorrents.slice(startIndex, endIndex);
  }, [endIndex, filteredTorrents, startIndex]);

  const topSpacerHeight = firstVirtualRow ? Math.max(0, firstVirtualRow.start - listOffsetTop) : 0;
  const bottomSpacerHeight = lastVirtualRow
    ? Math.max(0, virtualizer.getTotalSize() - (lastVirtualRow.end - listOffsetTop))
    : 0;

  const torrentByHash = useMemo(
    () => new Map(torrents.map((torrent) => [torrent.hash, torrent])),
    [torrents]
  );

  const torrentNameByHash = useMemo(
    () => new Map(torrents.map((torrent) => [torrent.hash, torrent.name])),
    [torrents]
  );

  // Category, tag and tracker choices come from the torrents loaded.
  const facetOptions = useMemo(() => torrentFacetOptions(torrents, facetFilters), [torrents, facetFilters]);
  const facetSetters = { categories: setCategoryFilter, tags: setTagFilter, trackers: setTrackerFilter };
  const facetGroups: TorrentFacetGroup[] = TORRENT_FACETS.map((facet) => ({
    key: facet.key,
    title: facet.title,
    options: facetOptions[facet.key].map((value) => ({ value, label: value || facet.none })),
    selected: [...facetFilters[facet.key]],
    onChange: facetSetters[facet.key],
  }));

  // The filter menu's choices, named so a filtered list is never mistaken for
  // every torrent. The search box is a filter too, but shows itself.
  const menuFilters: ActiveFilter[] = [
    ...multiSelectFilters(filter, filterOptions, (next) => setFilter(next as typeof filter)),
    ...TORRENT_FACETS.flatMap((facet) => facetFilters[facet.key].map((value) => ({
      id: `${facet.key}:${value}`,
      label: value ? `${facet.title}: ${value}` : facet.none,
      onRemove: () => facetSetters[facet.key](facetFilters[facet.key].filter((other) => other !== value)),
    }))),
  ];
  const hasMenuFilters = menuFilters.length > 0;
  const activeFilters = [...menuFilters, ...searchFilter(search, () => setSearch(''))];
  const clearFilters = () => {
    setFilter([]);
    setCategoryFilter([]);
    setTagFilter([]);
    setTrackerFilter([]);
    setSearch('');
  };

  const selectAll = useCallback(() => {
    if (selectedTorrents.size === filteredTorrents.length) {
      setSelectedTorrents(new Set());
      return;
    }
    setSelectedTorrents(new Set(filteredTorrents.map((torrent) => torrent.hash)));
  }, [filteredTorrents, selectedTorrents.size]);

  // Shared by the table column headers and the sort dropdown: picking the
  // active key toggles direction; a new key gets its natural default.
  const handleHeaderSort = useCallback((key: SortKey) => {
    const { torrentsSortKey, torrentsSortDir } = useUIStore.getState();
    if (torrentsSortKey === key) {
      setSortDir(torrentsSortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'name' || key === 'category' || key === 'state' ? 'asc' : 'desc');
    }
  }, [setSortDir, setSortKey]);

  // Get detail torrent data from the list for session stats
  const detailTorrent = detailHash ? torrentByHash.get(detailHash) : null;

  const allSelected = selectedTorrents.size === filteredTorrents.length && filteredTorrents.length > 0;

  const { tableColumns, wrapTableRow } = useTorrentTable({
    allSelected,
    selectAll,
    selectedTorrents,
    toggleSelect,
    fetchDetail,
    torrentAction,
    openDeleteDrawer,
    openCategoryDrawer,
    openRename,
    canManageTorrents,
    canDeleteTorrents,
    canSelect: canSelectTorrents,
    visibleColumns: tableColumnChoice,
  });

  return (
    <div className="space-y-3 animate-content-in" style={toolbarStyle}>
      <PullToRefresh onRefresh={() => refetchSummary()} />
      <PageTitle>Torrents</PageTitle>
      <TorrentsToolbar
        ref={toolbarRef}
        menuFilters={menuFilters}
        filter={filter}
        setFilter={setFilter}
        facetGroups={facetGroups}
        sortKey={sortKey}
        sortDir={sortDir}
        setSortDir={setSortDir}
        handleHeaderSort={handleHeaderSort}
        refresh={refresh}
        refreshing={refreshing}
        canBandwidthTorrents={canBandwidthTorrents}
        speedLimitsMode={speedLimitsMode}
        toggleAltSpeedMode={toggleAltSpeedMode}
        router={router}
        canViewLinked={canViewLinked}
        canAddTorrents={canAddTorrents}
        transferInfo={transferInfo}
        search={search}
        setSearch={setSearch}
        qbit={qbit}
      />
      {/* Below the sticky toolbar, so it can't push over sticky table headers;
          the filter button's dot stays in view. */}
      <ActiveFilterBar filters={activeFilters} onClearAll={clearFilters} />

      {canSelectTorrents && selectedTorrents.size > 0 && (
        <TorrentsBulkBar
          selectedTorrents={selectedTorrents}
          canManageTorrents={canManageTorrents}
          bulkAction={bulkAction}
          canBandwidthTorrents={canBandwidthTorrents}
          openBulkSpeedLimits={openBulkSpeedLimits}
          openOrganize={openOrganize}
          openBulkCategory={openBulkCategory}
          canDeleteTorrents={canDeleteTorrents}
          setDeleteDrawer={setDeleteDrawer}
          setSelectedTorrents={setSelectedTorrents}
        />
      )}

      {/* A failed background poll shouldn't blank a still-populated list; show a
          small inline banner instead and keep the last-good torrents rendered. */}
      {error && torrents.length > 0 && (
        <div className="mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-center text-xs text-red-400 light:text-red-800">
          {error}
        </div>
      )}

      {loading && torrents.length === 0 ? (
        <ListSkeleton />
      ) : error && torrents.length === 0 ? (
        <div className="rounded-xl bg-card p-8 text-center text-muted-foreground">
          <p>{error}</p>
          <p className="text-sm mt-2">
            {offline ? 'Torrents load again when the connection returns.' : 'Make sure qBittorrent is configured in Settings.'}
          </p>
        </div>
      ) : filteredTorrents.length === 0 ? (
        <div className="rounded-xl bg-card p-8 text-center text-muted-foreground">
          {/* A filtered-out list must not read like an empty client. */}
          <p>{torrentsEmptyMessage(search.trim().length > 0, hasMenuFilters)}</p>
          {(search.trim() || hasMenuFilters) && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={clearFilters}
            >
              Clear search & filters
            </Button>
          )}
          {/* An empty client: point at the toolbar's Add for those who may add. */}
          {!search.trim() && !hasMenuFilters && canAddTorrents && (
            <Button variant="outline" size="sm" className="mt-3" onClick={() => router.push('/torrents/add')}>
              Add torrent
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-0">
          <div className="flex items-center gap-2 px-3 pb-2">
            {!isTableView && canSelectTorrents && (
              <label className="relative flex touch-target" data-context-menu-ignore>
                <input
                  type="checkbox"
                  checked={selectedTorrents.size === filteredTorrents.length && filteredTorrents.length > 0}
                  onChange={selectAll}
                  className="rounded border-border"
                  aria-label="Select all"
                />
              </label>
            )}
            <span className="text-xs text-muted-foreground">
              {filteredTorrents.length} torrent{filteredTorrents.length !== 1 ? 's' : ''}
            </span>
            {isTableView && (
              <>
                <div className="flex-1" />
                <TorrentColumnPicker columns={tableColumnChoice} onChange={setTableColumnChoice} />
              </>
            )}
          </div>

          {/* listRef marks the virtualized list origin: its top must coincide
              with row 0's render position (scrollMargin is measured from it),
              so it wraps ONLY the spacers + rows — never the count bar or the
              table header. */}
          {isTableView ? (
            <DataTable
              tableId="torrents"
              columns={tableColumns}
              rows={filteredTorrents}
              rowKey={(t) => `${qbitInstanceKey(instanceId)}:${t.hash}`}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={(key) => handleHeaderSort(key as SortKey)}
              wrapRow={wrapTableRow}
              resetPageKey={JSON.stringify([search, filter, facetFilters, sortKey, sortDir])}
              stickyHeader
            />
          ) : (
            <div ref={listRef}>
              {topSpacerHeight > 0 && (
                <div style={{ height: topSpacerHeight }} />
              )}

              <div className="rounded-xl bg-card overflow-hidden divide-y divide-border/50">
                {visibleTorrents.map((torrent) => (
                  <TorrentRow
                    key={`${qbitInstanceKey(instanceId)}:${torrent.hash}`}
                    torrent={torrent}
                    selected={selectedTorrents.has(torrent.hash)}
                    onToggleSelect={toggleSelect}
                    onFetchDetail={fetchDetail}
                    onTorrentAction={torrentAction}
                    onOpenDeleteDrawer={openDeleteDrawer}
                    onOpenCategoryDrawer={openCategoryDrawer}
                    onRename={openRename}
                  />
                ))}
              </div>

              {bottomSpacerHeight > 0 && (
                <div style={{ height: bottomSpacerHeight }} />
              )}
            </div>
          )}
        </div>
      )}

      {/* Detail Drawer */}
      <TorrentDetailDrawer
        detailHash={detailHash}
        setDetailHash={setDetailHash}
        setDetailData={setDetailData}
        torrentNameByHash={torrentNameByHash}
        detailLoading={detailLoading}
        detailData={detailData}
        detailTorrent={detailTorrent}
        canBandwidthTorrents={canBandwidthTorrents}
        canManageTorrents={canManageTorrents}
        router={router}
      />

      {/* Delete Drawer */}
      <TorrentDeleteDrawer
        deleteDrawer={deleteDrawer}
        setDeleteDrawer={setDeleteDrawer}
        handleDelete={handleDelete}
        deleting={deleting}
      />

      {/* Category Picker Drawer */}
      <TorrentCategoryDrawer
        categoryDrawer={categoryDrawer}
        setCategoryDrawer={setCategoryDrawer}
        categoriesLoading={categoriesLoading}
        categories={categories}
        pickCategory={pickCategory}
      />

    </div>
  );
}
