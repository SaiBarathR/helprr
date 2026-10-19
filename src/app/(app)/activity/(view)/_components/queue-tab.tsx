'use client';

import { useRouteViewState } from '@/lib/hooks/use-route-view-state';
import { useEffect, useMemo, useState } from 'react';
import Link from '@/components/ui/app-link';
import { useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ListSkeleton } from '@/components/ui/list-skeleton';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { SwipeRow } from '@/components/ui/swipe-row';
import { QuickContextMenu } from '@/components/ui/quick-context-menu';
import {
  Download,
  Trash2,
  AlertTriangle,
  Upload,
  Loader2,
  ChevronRight,
  Layers,
  ExternalLink,
  Info,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import type { QueueItem } from '@/types';
import { getRefreshIntervalMs } from '@/lib/client-refresh-settings';
import { useRestorableInfiniteQuery as useInfiniteQuery } from '@/lib/hooks/use-restorable-infinite-query';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { ApiError, backoffRefetchInterval } from '@/lib/query-fetch';
import { invalidateActivity } from '@/lib/query-invalidation';
import { classifyQueueIssue } from '@/lib/queue-state';
import { applyPendingImports, pendingImportKey, usePendingImports } from '@/lib/manual-import-tracker';
import { useCan } from '@/components/permission-provider';
import { useBadgeActions } from '@/components/layout/badge-provider';
import { RemoveQueueDialog, type RemoveQueueOptions } from '../../_components/remove-queue-dialog';
import { compareActivityQueueItems } from '@/lib/activity-queue-sort';
import type { ActivitySortDirectionPreference } from '@/lib/store';
import { QUEUE_PAGE_SIZE, QUEUE_QUERY_KEY, QueuePage, QueueRecord, RemoveTarget, appNameFor, canManualImport, downloadSiblings, episodeLabel, formatBytes, getQueueCustomFormats, getQueueItemQuality, getQueueMediaHref, groupQueueByDownload, manualImportHref, packNoun, queueRecordKey, queueRemovalDelta, statusColor, statusLabel, uniqueQueueRecords } from './queue-records';
import { ManualImportStrip, TabErrorState } from './shared';
import { SortKey } from './view-state';

/**
 * Renders the Queue tab UI for activity, showing current download/import queue items.
 *
 * Polls the server for queue records at a configurable interval, applies the provided filter and sort,
 * reports the visible item count via `onCountChange`, and exposes per-item details and removal from the queue.
 *
 * @param sortBy - Key used to sort visible queue items (title, progress, timeleft, or size)
 * @param sortDirection - Direction applied to the selected queue sort
 * @param filterBy - Selected sources to limit items to (`'sonarr'`, `'radarr'`, `'lidarr'`); an empty array means all sources.
 * @param onCountChange - Callback invoked with the current number of visible items after filtering and sorting
 * @returns The rendered Queue tab content as a JSX element
 */
export function QueueTab({
  sortBy,
  sortDirection,
  filterBy,
  instanceFilter,
  onCountChange,
}: {
  sortBy: SortKey;
  sortDirection: ActivitySortDirectionPreference;
  filterBy: string[];
  instanceFilter: string;
  onCountChange: (count: number) => void;
}) {
  const router = useRouter();
  const canManageActivity = useCan('activity.manage');
  const { adjustBadge } = useBadgeActions();
  const queryClient = useQueryClient();
  const pendingImports = usePendingImports();
  const [selectedItem, setSelectedItem] = useState<(QueueItem & { source?: string }) | null>(null);
  const [removing, setRemoving] = useState(false);
  // The queue record or season-pack group the remove dialog is currently confirming.
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null);
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(5000);
  // Season-pack groups start collapsed; keyed by group key (stable across polls
  // since it derives from the download id), so an open group stays open on refetch.
  const [expandedKeys, setExpandedKeys] = useRouteViewState<Set<string>>('expandedKeys', () => new Set());
  const toggleExpand = (key: string) =>
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  useEffect(() => {
    // Load the configured activity refresh interval (ms); falls back to 5s.
    async function loadRefreshInterval() {
      const intervalMs = await getRefreshIntervalMs('activityRefreshIntervalSecs', 5);
      setRefreshIntervalMs(intervalMs);
    }
    loadRefreshInterval();
  }, []);

  // Poll the queue: pause when the tab is hidden, refetch on return, back off on
  // failure — same behavior the old useVisibleInterval provided. Page N holds
  // each instance's Nth QUEUE_PAGE_SIZE downloads; Load more adds a page.
  const queueQuery = useInfiniteQuery({
    queryKey: QUEUE_QUERY_KEY,
    queryFn: async ({ pageParam, signal }) => {
      const res = await fetch(`/api/activity/queue?page=${pageParam}&pageSize=${QUEUE_PAGE_SIZE}`, { signal });
      if (!res.ok) throw new ApiError(res.status, `GET /api/activity/queue → ${res.status}`);
      return (await res.json()) as QueuePage;
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, page) => sum + (page.records?.length ?? 0), 0);
      return (lastPage.records?.length ?? 0) > 0 && loaded < (allPages[0]?.totalRecords ?? 0) ? allPages.length + 1 : undefined;
    },
    refetchInterval: backoffRefetchInterval(refreshIntervalMs),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const queueTotal = queueQuery.data?.pages[0]?.totalRecords ?? 0;
  // Imports started from the import page read as importing until the *arr's
  // queue says how they went. A download that moved between pages while they
  // were fetched would otherwise show twice.
  const queue = useMemo(
    () => applyPendingImports(uniqueQueueRecords(queueQuery.data?.pages.flatMap((page) => page.records ?? []) ?? []), pendingImports),
    [queueQuery.data, pendingImports],
  );
  // The drawer offers the import when any record of the selected download needs
  // one: a season pack opens it on its first episode.
  const selectedImportItem = selectedItem
    ? queue.find((record) => pendingImportKey(record) === pendingImportKey(selectedItem) && canManualImport(record))
    : undefined;
  const loading = queueQuery.isLoading;

  // Apply filter
  const filtered = queue.filter((item) =>
    (filterBy.length === 0 || (item.source !== undefined && filterBy.includes(item.source)))
    && (instanceFilter === 'all' || item.instanceId === instanceFilter)
  );

  // Collapse multi-episode downloads (season packs) into one entry, then sort the
  // groups by their representative record so a pack sorts as a single task.
  const groups = groupQueueByDownload(filtered);
  const sorted = [...groups].sort((a, b) => {
    return compareActivityQueueItems(a.rep, b.rep, sortBy, sortDirection);
  });

  useEffect(() => {
    onCountChange(sorted.length);
  }, [sorted.length, onCountChange]);

  async function executeRemoval(opts: RemoveQueueOptions) {
    const target = removeTarget;
    if (!target) return;
    const removeFromClient = opts.method === 'removeFromClient';
    const changeCategory = opts.method === 'changeCategory';
    // removeFromClient/changeCategory act on the whole torrent, so a single DELETE on the
    // representative record clears every sibling; "ignore" only drops the record(s) we hit.
    const teardown = removeFromClient || changeCategory;

    // Records to DELETE, the rows to drop optimistically (teardown clears every
    // sibling server-side, so the UI should drop them all too), and the badge delta.
    let toDelete: QueueRecord[];
    let uiRemove: QueueRecord[];
    let delta: { count: number; attention: number };
    if (target.kind === 'pack') {
      delta = queueRemovalDelta(target.group.items);
      toDelete = teardown ? [target.group.rep] : target.group.items;
      uiRemove = target.group.items;
    } else {
      const item = target.item;
      const siblings = teardown ? downloadSiblings(queue, item) : [item];
      delta = teardown
        ? queueRemovalDelta(siblings)
        : {
          count: 1,
          attention: classifyQueueIssue(item.trackedDownloadState, item.trackedDownloadStatus) !== null ? 1 : 0,
        };
      toDelete = [item];
      uiRemove = siblings;
    }
    const source = (target.kind === 'pack' ? target.group.rep.source : target.item.source) || 'sonarr';

    setRemoving(true);
    // Optimistically drop the rows so removal feels instant: stop a racing poll
    // from clobbering the patch, snapshot for rollback, then patch the raw
    // { records } cache shape (the query's `select` derives the array from it).
    await queryClient.cancelQueries({ queryKey: QUEUE_QUERY_KEY });
    const snapshot = queryClient.getQueryData<InfiniteData<QueuePage>>(QUEUE_QUERY_KEY);
    if (snapshot) {
      const removeIds = new Set(uiRemove.map(queueRecordKey));
      queryClient.setQueryData<InfiniteData<QueuePage>>(QUEUE_QUERY_KEY, {
        ...snapshot,
        pages: snapshot.pages.map((page) => ({
          ...page,
          records: (page.records ?? []).filter((rec) => !removeIds.has(queueRecordKey(rec))),
        })),
      });
    }
    try {
      for (const rec of toDelete) {
        const params = new URLSearchParams({
          source: rec.source || 'sonarr',
          removeFromClient: String(removeFromClient),
          blocklist: String(opts.blocklist),
        });
        if (changeCategory) params.set('changeCategory', 'true');
        if (opts.skipRedownload) params.set('skipRedownload', 'true');
        if (rec.instanceId) params.set('instanceId', rec.instanceId);
        const res = await fetch(`/api/activity/queue/${rec.id}?${params.toString()}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to remove');
        }
      }
      toast.success(delta.count > 1 ? `Removed ${delta.count} ${packNoun(source)} from queue` : 'Removed from queue');
      // Optimistic nudge only on full success; the badge poll reconciles a partial delete.
      adjustBadge('activity', -(delta.count || 1), -delta.attention);
    } catch (e) {
      // Roll back the optimistic drop; the finally-refetch reconciles a partial delete.
      if (snapshot) queryClient.setQueryData(QUEUE_QUERY_KEY, snapshot);
      toast.error(e instanceof Error ? e.message : 'Failed to remove');
    }
    finally {
      // Always close the dialog and refetch: a pack "ignore" deletes records one by one,
      // so a mid-loop failure can leave some already gone — the refetch reflects reality,
      // and re-running a stale dialog would just retry the deleted records and never succeed.
      setRemoving(false);
      setRemoveTarget(null);
      void invalidateActivity(queryClient);
    }
  }

  // Representative record for the remove dialog's copy and option gating.
  const removeRep = removeTarget?.kind === 'pack' ? removeTarget.group.rep : removeTarget?.item;

  if (loading) {
    return <ListSkeleton />;
  }

  if (sorted.length === 0) {
    if (queueQuery.isError) {
      return <TabErrorState message="Couldn't load the queue" onRetry={() => queueQuery.refetch()} />;
    }
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Download className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">No items in queue</p>
      </div>
    );
  }

  return (
    <>
      {/* A failed background poll shouldn't blank a still-populated queue; show
          a small inline banner instead and keep the last-good records rendered. */}
      {queueQuery.isError && queue.length > 0 && (
        <div className="mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-center text-xs text-red-400 light:text-red-800">
          Live updates paused — retrying…
        </div>
      )}
      <div className="space-y-2 animate-list-in">
        {sorted.map((group) => {
          const { rep } = group;
          const progress = rep.size > 0 ? ((rep.size - rep.sizeleft) / rep.size) * 100 : 0;
          const qualityName = getQueueItemQuality(rep);

          // Single-item download → the existing card, opening the detail drawer.
          if (!group.isPack) {
            const mediaHref = getQueueMediaHref(rep);
            return (
              <SwipeRow
                key={group.key}
                className="rounded-xl"
                rightAction={canManageActivity ? {
                  label: 'Remove',
                  icon: <Trash2 className="h-4 w-4" />,
                  className: 'bg-destructive text-destructive-foreground',
                  onAction: () => setRemoveTarget({ kind: 'item', item: rep }),
                } : undefined}
              >
                <div className="rounded-xl bg-muted/30 overflow-hidden">
                  <QuickContextMenu
                    label={`Actions for ${rep.title}`}
                    groups={[
                      {
                        id: 'navigation',
                        actions: [
                          {
                            id: 'view-details',
                            label: 'View details',
                            icon: <Info className="h-4 w-4" />,
                            onSelect: () => setSelectedItem(rep),
                          },
                          ...(mediaHref
                            ? [{
                              id: 'open-media',
                              label: 'Open related media',
                              icon: <ExternalLink className="h-4 w-4" />,
                              href: mediaHref,
                            }]
                            : []),
                          ...(canManageActivity && canManualImport(rep)
                            ? [{
                              id: 'manual-import',
                              label: 'Open Manual Import',
                              icon: <Upload className="h-4 w-4" />,
                              onSelect: () => router.push(manualImportHref(rep)),
                            }]
                            : []),
                        ],
                      },
                      {
                        id: 'destructive',
                        actions: canManageActivity
                          ? [{
                            id: 'remove',
                            label: 'Remove from queue',
                            icon: <Trash2 className="h-4 w-4" />,
                            destructive: true,
                            onSelect: () => setRemoveTarget({ kind: 'item', item: rep }),
                          }]
                          : [],
                      },
                    ]}
                  >
                    <button
                      onClick={() => setSelectedItem(rep)}
                      className="w-full text-left p-3 space-y-2 active:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{rep.title}</p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <Badge
                              variant="secondary"
                              className={`text-[10px] px-1.5 py-0 ${statusColor(rep.status, rep.trackedDownloadStatus)}`}
                            >
                              {statusLabel(rep)}
                            </Badge>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              {rep.source}
                            </Badge>
                            {qualityName && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                {qualityName}
                              </Badge>
                            )}
                            {typeof rep.customFormatScore === 'number' && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                CF {rep.customFormatScore}
                              </Badge>
                            )}
                            {rep.indexer && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                {rep.indexer}
                              </Badge>
                            )}
                          </div>
                        </div>
                        {rep.timeleft && (
                          <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
                            {rep.timeleft}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Progress value={progress} className="h-1.5 flex-1" />
                        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                          {progress.toFixed(0)}%
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>Left: {formatBytes(rep.sizeleft)}</span>
                        <span>Total: {formatBytes(rep.size)}</span>
                      </div>
                    </button>
                  </QuickContextMenu>
                  {canManageActivity && canManualImport(rep) && (
                    <ManualImportStrip item={rep} onImport={() => router.push(manualImportHref(rep))} />
                  )}
                </div>
              </SwipeRow>
            );
          }

          // Season pack → one collapsible card; tapping the header toggles the
          // per-episode list, each row opening that episode's detail drawer.
          const open = expandedKeys.has(group.key);
          const season = rep.seasonNumber ?? rep.episode?.seasonNumber;
          const packTitle = rep.series?.title
            ? `${rep.series.title}${season != null ? ` · Season ${season}` : ''}`
            : rep.artist?.artistName ?? rep.album?.title ?? rep.title;
          // Surface a blocked/failed buried record on the collapsed header — the
          // header status only reflects rep, so without this the attention badge
          // counts it server-side with no visible cause until the pack is expanded.
          const hasAttention = group.items.some(
            (it) => classifyQueueIssue(it.trackedDownloadState, it.trackedDownloadStatus) !== null,
          );
          const episodes = [...group.items].sort((a, b) => {
            const sa = a.episode?.seasonNumber ?? a.seasonNumber ?? 0;
            const sb = b.episode?.seasonNumber ?? b.seasonNumber ?? 0;
            if (sa !== sb) return sa - sb;
            return (
              (a.episode?.episodeNumber ?? a.episodeNumber ?? 0) -
              (b.episode?.episodeNumber ?? b.episodeNumber ?? 0)
            );
          });
          const packMediaHref = getQueueMediaHref(rep);
          const packImportItem = group.items.find(canManualImport);

          return (
            <SwipeRow
              key={group.key}
              className="rounded-xl"
              rightAction={canManageActivity ? {
                label: 'Remove',
                icon: <Trash2 className="h-4 w-4" />,
                className: 'bg-destructive text-destructive-foreground',
                onAction: () => setRemoveTarget({ kind: 'pack', group }),
              } : undefined}
            >
              <div className="rounded-xl bg-muted/30 overflow-hidden">
                <div className="flex items-stretch">
                  <QuickContextMenu
                    label={`Actions for ${packTitle}`}
                    groups={[
                      {
                        id: 'navigation',
                        actions: [
                          {
                            id: 'view-details',
                            label: 'View download details',
                            icon: <Info className="h-4 w-4" />,
                            onSelect: () => setSelectedItem(rep),
                          },
                          {
                            id: 'toggle-pack',
                            label: open ? 'Collapse pack' : 'Expand pack',
                            icon: <ChevronRight className={`h-4 w-4 ${open ? 'rotate-90' : ''}`} />,
                            onSelect: () => toggleExpand(group.key),
                          },
                          ...(packMediaHref
                            ? [{
                              id: 'open-media',
                              label: 'Open related media',
                              icon: <ExternalLink className="h-4 w-4" />,
                              href: packMediaHref,
                            }]
                            : []),
                          ...(canManageActivity && packImportItem
                            ? [{
                              id: 'manual-import',
                              label: 'Open Manual Import',
                              icon: <Upload className="h-4 w-4" />,
                              onSelect: () => router.push(manualImportHref(packImportItem)),
                            }]
                            : []),
                        ],
                      },
                      {
                        id: 'destructive',
                        actions: canManageActivity
                          ? [{
                            id: 'remove-pack',
                            label: 'Remove pack from queue',
                            icon: <Trash2 className="h-4 w-4" />,
                            destructive: true,
                            onSelect: () => setRemoveTarget({ kind: 'pack', group }),
                          }]
                          : [],
                      },
                    ]}
                  >
                    <button
                      onClick={() => toggleExpand(group.key)}
                      aria-expanded={open}
                      className="min-w-0 flex-1 text-left p-3 space-y-2 active:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{packTitle}</p>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <Badge
                              variant="secondary"
                              className={`text-[10px] px-1.5 py-0 ${statusColor(rep.status, rep.trackedDownloadStatus)}`}
                            >
                              {statusLabel(rep)}
                            </Badge>
                            {hasAttention && (
                              <AlertTriangle className="h-3 w-3 text-amber-500" aria-label="Some items need attention" />
                            )}
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1">
                              <Layers className="h-2.5 w-2.5" />
                              {group.items.length} {packNoun(rep.source)}
                            </Badge>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              {rep.source}
                            </Badge>
                            {qualityName && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                {qualityName}
                              </Badge>
                            )}
                            {rep.indexer && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                {rep.indexer}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0 mt-0.5">
                          {rep.timeleft && (
                            <span className="text-[10px] text-muted-foreground">{rep.timeleft}</span>
                          )}
                          <ChevronRight
                            className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Progress value={progress} className="h-1.5 flex-1" />
                        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                          {progress.toFixed(0)}%
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>Left: {formatBytes(rep.sizeleft)}</span>
                        <span>Total: {formatBytes(rep.size)}</span>
                      </div>
                    </button>
                  </QuickContextMenu>
                  {canManageActivity && (
                    <button
                      onClick={() => setRemoveTarget({ kind: 'pack', group })}
                      aria-label="Remove pack from queue"
                      className="shrink-0 px-3 flex items-center justify-center border-l border-border/40 text-muted-foreground active:bg-destructive/10 active:text-destructive transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {canManageActivity && packImportItem && (
                  <ManualImportStrip item={packImportItem} onImport={() => router.push(manualImportHref(packImportItem))} />
                )}

                {open && (
                  <div className="border-t border-border/40 divide-y divide-border/30">
                    {episodes.map((ep) => {
                      const label = episodeLabel(ep);
                      const episodeHref = getQueueMediaHref(ep);
                      return (
                        <QuickContextMenu
                          key={`${ep.source}-${ep.instanceId ?? ''}-${ep.id}`}
                          label={`Actions for ${ep.episode?.title || ep.title}`}
                          groups={[
                            {
                              id: 'navigation',
                              actions: [
                                {
                                  id: 'view-details',
                                  label: 'View details',
                                  icon: <Info className="h-4 w-4" />,
                                  onSelect: () => setSelectedItem(ep),
                                },
                                ...(episodeHref
                                  ? [{
                                    id: 'open-media',
                                    label: 'Open related media',
                                    icon: <ExternalLink className="h-4 w-4" />,
                                    href: episodeHref,
                                  }]
                                  : []),
                              ],
                            },
                            {
                              id: 'destructive',
                              actions: canManageActivity
                                ? [{
                                  id: 'remove-item',
                                  label: 'Remove from queue',
                                  icon: <Trash2 className="h-4 w-4" />,
                                  destructive: true,
                                  onSelect: () => setRemoveTarget({ kind: 'item', item: ep }),
                                }]
                                : [],
                            },
                          ]}
                        >
                          <button
                            onClick={() => setSelectedItem(ep)}
                            className="w-full text-left px-3 py-2 flex items-center gap-2 active:bg-muted/50 transition-colors"
                          >
                            {label && (
                              <span className="text-[10px] font-mono text-muted-foreground tabular-nums shrink-0 w-11">
                                {label}
                              </span>
                            )}
                            <span className="text-xs truncate flex-1">
                              {ep.episode?.title || ep.title}
                            </span>
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          </button>
                        </QuickContextMenu>
                      );
                    })}
                  </div>
                )}
              </div>
            </SwipeRow>
          );
        })}
        {queue.length < queueTotal && (
          <div className="space-y-1 pt-1 text-center">
            <p className="text-xs text-muted-foreground">
              {queue.length.toLocaleString()} of {queueTotal.toLocaleString()} queue items loaded
            </p>
            {queueQuery.hasNextPage && (
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => queueQuery.fetchNextPage()}
                disabled={queueQuery.isFetchingNextPage}
              >
                {queueQuery.isFetchingNextPage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Load more
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Queue item detail drawer */}
      <Drawer open={!!selectedItem} onOpenChange={(open) => { if (!open) setSelectedItem(null); }}>
        <DrawerContent>
          {selectedItem && (() => {
            const progress = selectedItem.size > 0
              ? ((selectedItem.size - selectedItem.sizeleft) / selectedItem.size) * 100
              : 0;
            const qualityName = getQueueItemQuality(selectedItem);
            const customFormats = getQueueCustomFormats(selectedItem);
            const languageNames = selectedItem.languages?.map((language) => language.name).filter(Boolean).join(', ');
            const mediaHref = getQueueMediaHref(selectedItem);
            const mediaTitle = selectedItem.series?.title || selectedItem.movie?.title || undefined;
            const mediaSubtitle = selectedItem.episode
              ? `S${String(selectedItem.episode.seasonNumber).padStart(2, '0')}E${String(selectedItem.episode.episodeNumber).padStart(2, '0')} - ${selectedItem.episode.title}`
              : selectedItem.movie?.year
                ? String(selectedItem.movie.year)
                : selectedItem.seasonNumber
                  ? `Season ${selectedItem.seasonNumber}`
                  : undefined;

            return (
              <>
                <DrawerHeader className="text-left">
                  <Badge
                    variant="secondary"
                    className={`w-fit text-[10px] px-2 py-0.5 ${statusColor(selectedItem.status, selectedItem.trackedDownloadStatus)}`}
                  >
                    {statusLabel(selectedItem)}
                  </Badge>
                  <DrawerTitle className="text-sm break-all leading-snug mt-1">
                    {selectedItem.title}
                  </DrawerTitle>
                  <p className="text-xs text-muted-foreground">
                    {qualityName && `${qualityName} · `}
                    {formatBytes(selectedItem.size)}
                  </p>
                </DrawerHeader>

                <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-6 space-y-4">
                  {/* Tags row */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {selectedItem.source && (
                      <Badge variant="outline" className="text-[10px]">
                        {selectedItem.source?.toUpperCase()}
                      </Badge>
                    )}
                    {selectedItem.indexer && (
                      <Badge variant="outline" className="text-[10px]">
                        {selectedItem.indexer}
                      </Badge>
                    )}
                  </div>

                  {mediaHref && (
                    <Link
                      href={mediaHref}
                      className="flex items-center gap-2 rounded-lg bg-muted/30 p-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{mediaTitle || selectedItem.title}</p>
                        {mediaSubtitle && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{mediaSubtitle}</p>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </Link>
                  )}

                  {/* Progress bar */}
                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>{progress.toFixed(1)}%</span>
                      {selectedItem.timeleft && <span>{selectedItem.timeleft}</span>}
                    </div>
                    <Progress value={progress} className="h-2" />
                  </div>

                  {canManageActivity && selectedImportItem && (
                    <Button
                      className="w-full"
                      onClick={() => { router.push(manualImportHref(selectedImportItem)); setSelectedItem(null); }}
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      Manual Import
                    </Button>
                  )}

                  {/* Remove button */}
                  {canManageActivity && (
                    <Button
                      variant="outline"
                      className="w-full border-destructive text-destructive hover:bg-destructive/10"
                      onClick={() => { setRemoveTarget({ kind: 'item', item: selectedItem }); setSelectedItem(null); }}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Remove
                    </Button>
                  )}

                  {/* Information section */}
                  <div>
                    <h3 className="font-semibold text-sm mb-2">Information</h3>
                    <div className="space-y-0 rounded-lg border divide-y">
                      <InfoRow label="Protocol" value={selectedItem.protocol || '-'} />
                      <InfoRow label="Client" value={selectedItem.downloadClient || '-'} />
                      <InfoRow label="Indexer" value={selectedItem.indexer || '-'} />
                      {qualityName && <InfoRow label="Quality" value={qualityName} />}
                      {typeof selectedItem.customFormatScore === 'number' && (
                        <InfoRow label="Custom Format Score" value={String(selectedItem.customFormatScore)} />
                      )}
                      {customFormats && <InfoRow label="Custom Formats" value={customFormats} />}
                      {languageNames && <InfoRow label="Languages" value={languageNames} />}
                      <InfoRow label="Total Size" value={formatBytes(selectedItem.size)} />
                      <InfoRow label="Size Left" value={formatBytes(selectedItem.sizeleft)} />
                      {selectedItem.estimatedCompletionTime && (
                        <InfoRow
                          label="ETA"
                          value={formatDistanceToNow(new Date(selectedItem.estimatedCompletionTime), { addSuffix: true })}
                        />
                      )}
                      {selectedItem.statusMessages?.length > 0 && (
                        <InfoRow
                          label="Messages"
                          value={selectedItem.statusMessages.map((m) => m.title).join(', ')}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </>
            );
          })()}
        </DrawerContent>
      </Drawer>

      <RemoveQueueDialog
        open={!!removeTarget}
        onOpenChange={(o) => { if (!o) setRemoveTarget(null); }}
        title={removeRep?.title ?? ''}
        appName={appNameFor(removeRep?.source)}
        canChangeCategory={!!removeRep?.downloadClientHasPostImportCategory}
        busy={removing}
        onConfirm={executeRemoval}
      />
    </>
  );
}

// --- Info row helper ---

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs text-right max-w-[60%] break-words">{value}</span>
    </div>
  );
}
