'use client';

import { useRouteViewState } from '@/lib/hooks/use-route-view-state';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToolbarHeight } from '@/lib/hooks/use-toolbar-height';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ActiveFilterBar, multiSelectFilters, searchFilter } from '@/components/ui/active-filter-bar';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { reportBulkTorrent } from '@/lib/bulk-fan-out';
import { ListSkeleton } from '@/components/ui/list-skeleton';
import { DataTable } from '@/components/ui/data-table';
import type { QBittorrentTorrent } from '@/types';
import type { TorrentFile, TorrentTracker } from '@/lib/qbittorrent-client';
import { useUIStore, type TorrentsSortKeyPreference as SortKey } from '@/lib/store';
import { useCan } from '@/components/permission-provider';
import { useBadgeActions } from '@/components/layout/badge-provider';
import { setSpeedLimitTargets } from './_components/speed-limit-targets';
import { torrentsEmptyMessage } from './_components/empty-message';
import {
  OPTIMISTIC_OVERRIDE_FIELD,
  OPTIMISTIC_ROW_PATCHES,
  OPTIMISTIC_STATE_TTL_MS,
  TORRENT_ROW_HEIGHT,
  compareTorrents,
  filterOptions,
  matchesTorrentFilter,
  torrentActionMessage,
} from './_components/torrent-list';
import { TorrentRow } from './_components/torrent-row';
import { useTorrentsSummary } from './_components/use-torrents-summary';
import { useTorrentTable } from './_components/use-torrent-table';
import { TorrentsToolbar } from './_components/torrents-toolbar';
import { TorrentsBulkBar } from './_components/torrents-bulk-bar';
import { TorrentDetailDrawer } from './_components/torrent-detail-drawer';
import { TorrentDeleteDrawer } from './_components/torrent-delete-drawer';
import { TorrentCategoryDrawer } from './_components/torrent-category-drawer';


// --- Main page ---

export default function TorrentsPage() {
  const { toolbarRef, toolbarStyle } = useToolbarHeight();
  const router = useRouter();
  const { adjustBadge } = useBadgeActions();
  const canManageTorrents = useCan('torrents.manage');
  const canDeleteTorrents = useCan('torrents.delete');
  const canBandwidthTorrents = useCan('torrents.bandwidth');
  const canAddTorrents = useCan('torrents.add');
  const canViewLinked = useCan('activity.view');
  const hasHydrated = useUIStore((s) => s.hasHydrated);
  const filter = useUIStore((s) => s.torrentsFilter);
  const setFilter = useUIStore((s) => s.setTorrentsFilter);
  const sortKey = useUIStore((s) => s.torrentsSortKey);
  const setSortKey = useUIStore((s) => s.setTorrentsSortKey);
  const sortDir = useUIStore((s) => s.torrentsSortDir);
  const setSortDir = useUIStore((s) => s.setTorrentsSortDir);
  const viewMode = useUIStore((s) => s.torrentsView);
  // 'auto' picks the table from Tailwind's lg breakpoint up.
  const isBelowLg = useIsMobile(1023);
  const isTableView = viewMode === 'table' || (viewMode === 'auto' && !isBelowLg);
  const [search, setSearch] = useRouteViewState('search', '');
  const [selectedTorrents, setSelectedTorrents] = useState<Set<string>>(new Set());
  const [listOffsetTop, setListOffsetTop] = useState(0);

  const [detailHash, setDetailHash] = useState<string | null>(null);
  // Mirrors detailHash so an in-flight detail fetch can tell it was superseded
  // (another torrent opened, or the drawer closed) and drop its response.
  const detailHashRef = useRef<string | null>(null);
  const detailAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => detailAbortRef.current?.abort(), []);
  const [detailData, setDetailData] = useState<{
    properties: Record<string, unknown>;
    files: TorrentFile[];
    trackers: TorrentTracker[];
  } | null>(null);
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
  const [categoryDrawer, setCategoryDrawer] = useState<{ open: boolean; hash: string }>({ open: false, hash: '' });
  const [categories, setCategories] = useState<Record<string, { name: string; savePath: string }>>({});
  const [categoriesLoading, setCategoriesLoading] = useState(false);

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
  } = useTorrentsSummary(filter, hasHydrated);

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
      const res = await fetch(`/api/qbittorrent/${hash}/details`, { signal: controller.signal });
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
  }, []);

  useEffect(() => {
    setSelectedTorrents((prev) => {
      if (prev.size === 0) return prev;
      const availableHashes = new Set(torrents.map((torrent) => torrent.hash));
      const next = new Set(Array.from(prev).filter((hash) => availableHashes.has(hash)));
      return next.size === prev.size ? prev : next;
    });
  }, [torrents]);

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
  }, [selectedTorrents.size, loading, error, torrents.length, search, filter, isTableView]);

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
      const res = await fetch('/api/qbittorrent', {
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
  }, [refetchSummary, pendingDeleteRef, pendingFieldRef, setTorrents, torrentsRef]);

  const bulkAction = useCallback(async (action: string, extra?: Record<string, unknown>): Promise<boolean> => {
    if (selectedTorrents.size === 0) return false;
    const count = selectedTorrents.size;
    const hashes = Array.from(selectedTorrents).join('|');
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

  const openCategoryDrawer = useCallback(async (hash: string) => {
    setCategoryDrawer({ open: true, hash });
    setCategoriesLoading(true);
    try {
      // Fetch categories via a dedicated endpoint call
      const res = await fetch('/api/qbittorrent/categories');
      if (res.ok) {
        setCategories(await res.json());
      }
    } catch {
      // Fallback: extract unique categories from loaded torrents
      const cats: Record<string, { name: string; savePath: string }> = {};
      torrents.forEach((t) => {
        if (t.category) cats[t.category] = { name: t.category, savePath: '' };
      });
      setCategories(cats);
    } finally {
      setCategoriesLoading(false);
    }
  }, [torrents]);

  // Renaming and bulk limits are pages, not drawers: their text fields would
  // bring up the on-screen keyboard, which pushes a drawer out of view on iOS.
  const openRename = useCallback((hash: string) => {
    router.push(`/torrents/${hash}/rename`);
  }, [router]);

  const openBulkSpeedLimits = useCallback(() => {
    setSpeedLimitTargets(torrents
      .filter((t) => selectedTorrents.has(t.hash))
      .map(({ hash, name, dl_limit, up_limit }) => ({ hash, name, dl_limit, up_limit })));
    router.push('/torrents/speed-limits');
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
      const res = await fetch('/api/qbittorrent/transfer/limits', {
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
  }, [refetchSummary, speedLimitsMode, pendingSpeedModeRef, setSpeedLimitsMode]);

  const filteredTorrents = useMemo(() => {
    const q = search.trim().toLowerCase();
    let filtered = q ? torrents.filter((torrent) => torrent.name.toLowerCase().includes(q)) : [...torrents];
    if (filter.length > 0) {
      filtered = filtered.filter((t) => filter.some((f) => matchesTorrentFilter(t, f)));
    }
    filtered.sort((a, b) => {
      const cmp = compareTorrents(a, b, sortKey);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return filtered;
  }, [search, torrents, filter, sortKey, sortDir]);

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

  // The filter menu's choices, named so a filtered list is never mistaken for
  // every torrent. The search box is a filter too, but shows itself.
  const menuFilters = multiSelectFilters(filter, filterOptions, (next) => setFilter(next as typeof filter));
  const activeFilters = [...menuFilters, ...searchFilter(search, () => setSearch(''))];
  const clearFilters = () => {
    setFilter([]);
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

  // Get detail torrent data from the list for session stats / magnet
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
  });

  return (
    <div className="space-y-3 animate-content-in" style={toolbarStyle}>
      <PullToRefresh onRefresh={() => refetchSummary()} />
      <h1 className="sr-only">Torrents</h1>
      <TorrentsToolbar
        ref={toolbarRef}
        menuFilters={menuFilters}
        filter={filter}
        setFilter={setFilter}
        sortKey={sortKey}
        sortDir={sortDir}
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
      />
      {/* Below the sticky toolbar, so it can't push over sticky table headers;
          the filter button's dot stays in view. */}
      <ActiveFilterBar filters={activeFilters} onClearAll={clearFilters} />

      {selectedTorrents.size > 0 && (
        <TorrentsBulkBar
          selectedTorrents={selectedTorrents}
          canManageTorrents={canManageTorrents}
          bulkAction={bulkAction}
          canBandwidthTorrents={canBandwidthTorrents}
          openBulkSpeedLimits={openBulkSpeedLimits}
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
          <p className="text-sm mt-2">Make sure qBittorrent is configured in Settings.</p>
        </div>
      ) : filteredTorrents.length === 0 ? (
        <div className="rounded-xl bg-card p-8 text-center text-muted-foreground">
          {/* A filtered-out list must not read like an empty client. */}
          <p>{torrentsEmptyMessage(search.trim().length > 0, filter.length > 0)}</p>
          {(search.trim() || filter.length > 0) && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                setSearch('');
                setFilter([]);
              }}
            >
              Clear search & filters
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-0">
          <div className="flex items-center gap-2 px-3 pb-2">
            {!isTableView && (
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
              rowKey={(t) => t.hash}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={(key) => handleHeaderSort(key as SortKey)}
              wrapRow={wrapTableRow}
              resetPageKey={`${search}|${filter.join(',')}|${sortKey}|${sortDir}`}
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
                    key={torrent.hash}
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
        torrentAction={torrentAction}
      />

    </div>
  );
}
