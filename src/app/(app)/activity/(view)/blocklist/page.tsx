'use client';

import { useRouteViewState } from '@/lib/hooks/use-route-view-state';

import { useEffect, useMemo, useState } from 'react';
import { useRestorableInfiniteQuery as useInfiniteQuery } from '@/lib/hooks/use-restorable-infinite-query';
import { keepPreviousData, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FloatingActionBar } from '@/components/ui/floating-action-bar';
import { PageSpinner } from '@/components/ui/page-spinner';
import { QuickContextMenu } from '@/components/ui/quick-context-menu';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Copy, Info, ListChecks, Loader2, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { formatDateTime } from '@/lib/date-format';
import { toast } from 'sonner';
import { InstanceFilter, type InstanceOption, withAppName } from '@/components/instance-filter';
import { ActiveFilterBar, type ActiveFilter } from '@/components/ui/active-filter-bar';
import { useCan } from '@/components/permission-provider';
import type { BlocklistItem } from '@/types';

type BlocklistRecord = BlocklistItem & {
  source: 'sonarr' | 'radarr' | 'lidarr';
  instanceId: string;
  instanceLabel: string;
};

type BlocklistResponse = {
  records?: BlocklistRecord[];
  hasMore?: boolean;
  truncated?: boolean;
  partial?: boolean;
};

const BLOCKLIST_QUERY_PREFIX = ['activity', 'blocklist'] as const;

const recordKey = (item: BlocklistRecord) => `${item.source}-${item.instanceId}-${item.id}`;

function mediaTitle(item: BlocklistRecord): string | undefined {
  if (item.series?.title) return item.series.title;
  if (item.movie?.title) return item.movie.year ? `${item.movie.title} (${item.movie.year})` : item.movie.title;
  return item.artist?.artistName;
}

function timeAgo(date: string): string {
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? '' : formatDistanceToNow(d, { addSuffix: true });
}

/**
 * Remove entries, one request per instance (entry ids are per instance).
 * Resolves to how many entries each outcome covered.
 */
async function removeEntries(entries: BlocklistRecord[]): Promise<{ removed: number; failed: number }> {
  const groups = new Map<string, BlocklistRecord[]>();
  for (const entry of entries) {
    const key = `${entry.source}:${entry.instanceId}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const results = await Promise.all([...groups.values()].map(async (group) => {
    const res = await fetch('/api/activity/blocklist', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: group[0].source,
        instanceId: group[0].instanceId,
        ids: group.map((entry) => entry.id),
      }),
    }).catch(() => null);
    return { ok: !!res?.ok, count: group.length };
  }));
  return results.reduce(
    (sum, r) => (r.ok ? { ...sum, removed: sum.removed + r.count } : { ...sum, failed: sum.failed + r.count }),
    { removed: 0, failed: 0 },
  );
}

function buildBlocklistUrl(p: number, instanceFilter: string) {
  const params = new URLSearchParams({ page: String(p), pageSize: '20' });
  if (instanceFilter !== 'all') params.set('instanceId', instanceFilter);
  return `/api/activity/blocklist?${params}`;
}

/**
 * The releases Sonarr, Radarr and Lidarr refuse to grab again (blocklisted from the
 * queue's Remove dialog, the Queue Cleaner or a cancelled manual download), newest
 * first, with Remove to let a release be grabbed again.
 */
export default function BlocklistPage() {
  const canManage = useCan('activity.manage');
  const queryClient = useQueryClient();
  const [instanceFilter, setInstanceFilter] = useRouteViewState<string>('instanceFilter', 'all');
  const [selectedItem, setSelectedItem] = useState<BlocklistRecord | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  // The entries the open confirm dialog would remove.
  const [confirmTargets, setConfirmTargets] = useState<BlocklistRecord[] | null>(null);
  const [removing, setRemoving] = useState(false);

  const {
    data,
    isLoading: loading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: [...BLOCKLIST_QUERY_PREFIX, { instanceFilter }],
    queryFn: ({ pageParam, signal }) =>
      jsonFetcher<BlocklistResponse>(buildBlocklistUrl(pageParam, instanceFilter))({ signal }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length + 1 : undefined),
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    if (isError) toast.error('Failed to load blocklist');
  }, [isError]);

  // Each page is a slice of a fresh merge, so an entry added between loads pushes the
  // previous page's last row onto the next one: keep its first copy.
  const entries = useMemo(() => {
    const seen = new Set<string>();
    return (data?.pages.flatMap((pg) => pg.records ?? []) ?? []).filter((entry) => {
      const key = recordKey(entry);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [data]);
  const truncated = data?.pages.some((page) => page.truncated) ?? false;
  const partial = data?.pages.some((page) => page.partial) ?? false;
  const selectedEntries = entries.filter((entry) => selectedKeys.has(recordKey(entry)));

  // Same instance list (and query key) as the History page's filter.
  const { data: instanceOptions = [] } = useQuery({
    queryKey: queryKeys.arrInstances(),
    queryFn: jsonFetcher<Array<{ id: string; label: string; type: string }>>('/api/instances'),
    select: (conns): InstanceOption[] =>
      Array.isArray(conns) ? conns.map((c) => ({ id: c.id, label: withAppName(c.label, c.type) })) : [],
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (instanceFilter !== 'all' && !instanceOptions.some((i) => i.id === instanceFilter)) {
      setInstanceFilter('all');
    }
  }, [instanceOptions, instanceFilter, setInstanceFilter]);

  const activeFilters: ActiveFilter[] = instanceFilter !== 'all'
    ? [{
      id: 'instance',
      label: instanceOptions.find((i) => i.id === instanceFilter)?.label ?? 'Instance',
      onRemove: () => setInstanceFilter('all'),
    }]
    : [];

  const exitSelection = () => {
    setSelectionMode(false);
    setSelectedKeys(new Set());
  };

  const toggleSelected = (item: BlocklistRecord) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      const key = recordKey(item);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  async function confirmRemove() {
    if (!confirmTargets) return;
    setRemoving(true);
    try {
      const { removed, failed } = await removeEntries(confirmTargets);
      if (failed === 0) {
        toast.success(removed === 1 ? 'Removed from blocklist' : `Removed ${removed} entries from blocklist`);
      } else {
        toast.error(removed > 0
          ? `Removed ${removed}, but ${failed} could not be removed`
          : 'Failed to remove from blocklist');
      }
      setConfirmTargets(null);
      setSelectedItem(null);
      exitSelection();
    } finally {
      setRemoving(false);
      // Refetch either way: a partial failure leaves some entries gone. Only the first
      // page: page k asks every instance for k × 20 entries again.
      queryClient.setQueriesData<InfiniteData<BlocklistResponse>>(
        { queryKey: BLOCKLIST_QUERY_PREFIX },
        (old) => old && { pages: old.pages.slice(0, 1), pageParams: old.pageParams.slice(0, 1) },
      );
      void queryClient.invalidateQueries({ queryKey: BLOCKLIST_QUERY_PREFIX });
    }
  }

  return (
    <div className="flex flex-col min-h-0 animate-content-in">
      <PageHeader
        title="Blocklist"
        rightContent={
          <div className="flex items-center gap-2">
            <InstanceFilter instances={instanceOptions} value={instanceFilter} onChange={setInstanceFilter} />
            {canManage && entries.length > 0 && (
              <Button
                variant={selectionMode ? 'default' : 'ghost'}
                size="icon"
                className="h-8 w-8"
                onClick={() => (selectionMode ? exitSelection() : setSelectionMode(true))}
                aria-label={selectionMode ? 'Exit selection' : 'Select entries'}
                aria-pressed={selectionMode}
              >
                <ListChecks className="h-4 w-4" />
              </Button>
            )}
          </div>
        }
      />

      <ActiveFilterBar filters={activeFilters} onClearAll={() => setInstanceFilter('all')} className="pb-2" />

      {partial && (
        <p className="pb-2 text-xs text-amber-400">Some instances could not be reached; their entries are missing.</p>
      )}

      <div data-scroll-restoration-key="activity-blocklist" className="page-bleed flex-1 overflow-y-auto pb-4">
        {loading ? (
          <PageSpinner />
        ) : entries.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <p className="text-sm">{activeFilters.length > 0 ? 'No blocklisted releases on this instance' : 'No blocklisted releases'}</p>
          </div>
        ) : (
          <div className="space-y-1 animate-list-in">
            {entries.map((item) => (
              <BlocklistRow
                key={recordKey(item)}
                item={item}
                selectable={selectionMode}
                selected={selectedKeys.has(recordKey(item))}
                onSelect={() => (selectionMode ? toggleSelected(item) : setSelectedItem(item))}
                onRemove={canManage ? () => setConfirmTargets([item]) : undefined}
              />
            ))}

            {hasNextPage && (
              <Button
                variant="ghost"
                className="w-full mt-2"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Load more
              </Button>
            )}
            {truncated && !hasNextPage && (
              <p className="px-3 py-2 text-center text-xs text-amber-400">
                Only the newest entries are listed here.
              </p>
            )}
          </div>
        )}
      </div>

      {selectionMode && (
        <FloatingActionBar className="p-2">
          <span className="flex-1 px-2 text-sm text-muted-foreground">{selectedEntries.length} selected</span>
          <Button variant="ghost" className="h-11" onClick={exitSelection}>Cancel</Button>
          <Button
            variant="destructive"
            className="h-11"
            disabled={selectedEntries.length === 0}
            onClick={() => setConfirmTargets(selectedEntries)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Remove
          </Button>
        </FloatingActionBar>
      )}

      <BlocklistDrawer
        item={selectedItem}
        onClose={() => setSelectedItem(null)}
        onRemove={canManage ? (item) => { setSelectedItem(null); setConfirmTargets([item]); } : undefined}
      />

      <ConfirmDialog
        open={!!confirmTargets}
        onOpenChange={(open) => { if (!open && !removing) setConfirmTargets(null); }}
        title={confirmTargets && confirmTargets.length > 1
          ? `Remove ${confirmTargets.length} entries from the blocklist?`
          : 'Remove from the blocklist?'}
        description={confirmTargets && confirmTargets.length === 1
          ? `${confirmTargets[0].sourceTitle} can be grabbed again by an automatic or manual search.`
          : 'These releases can be grabbed again by an automatic or manual search.'}
        confirmLabel="Remove"
        destructive
        busy={removing}
        onConfirm={confirmRemove}
      />
    </div>
  );
}

function BlocklistRow({
  item,
  selectable,
  selected,
  onSelect,
  onRemove,
}: {
  item: BlocklistRecord;
  selectable: boolean;
  selected: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}) {
  const title = mediaTitle(item);
  return (
    <QuickContextMenu
      label={`Actions for ${item.sourceTitle}`}
      disabled={selectable}
      groups={[
        {
          id: 'navigation',
          actions: [{ id: 'view-details', label: 'View details', icon: <Info className="h-4 w-4" />, onSelect }],
        },
        {
          id: 'copy',
          actions: [{
            id: 'copy-source-title',
            label: 'Copy source title',
            icon: <Copy className="h-4 w-4" />,
            onSelect: () => void navigator.clipboard.writeText(item.sourceTitle).then(
              () => toast.success('Source title copied'),
              () => toast.error('Copy failed'),
            ),
          }],
        },
        ...(onRemove
          ? [{
            id: 'remove',
            actions: [{
              id: 'remove',
              label: 'Remove from blocklist',
              icon: <Trash2 className="h-4 w-4" />,
              destructive: true,
              onSelect: onRemove,
            }],
          }]
          : []),
      ]}
    >
      <button
        onClick={onSelect}
        aria-pressed={selectable ? selected : undefined}
        className="-mx-2 w-[calc(100%+1rem)] text-left flex items-start gap-3 py-2.5 px-2 rounded-lg hover:bg-muted/50 active:bg-muted/50 transition-colors md:-mx-3 md:w-[calc(100%+1.5rem)] md:px-3"
      >
        {selectable && <Checkbox checked={selected} tabIndex={-1} aria-hidden className="mt-0.5 pointer-events-none" />}
        <div className="flex-1 min-w-0 space-y-1">
          {title && <p className="text-xs text-muted-foreground truncate">{title}</p>}

          {/* Release name: up to two lines (the drawer has the full name) */}
          <p className="text-sm leading-snug break-words line-clamp-2">{item.sourceTitle}</p>

          <div className="flex items-center gap-1.5 flex-wrap">
            {item.quality?.quality?.name && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0">{item.quality.quality.name}</Badge>
            )}
            {item.indexer && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0">{item.indexer}</Badge>
            )}
            {item.protocol && item.protocol !== 'unknown' && (
              <Badge variant="outline" className="text-[9px] px-1.5 py-0">{item.protocol}</Badge>
            )}
            <Badge variant="outline" className="text-[9px] px-1.5 py-0">{item.source}</Badge>
          </div>
        </div>

        <span className="text-[10px] text-muted-foreground shrink-0 mt-1 tabular-nums">{timeAgo(item.date)}</span>
      </button>
    </QuickContextMenu>
  );
}

function BlocklistDrawer({
  item,
  onClose,
  onRemove,
}: {
  item: BlocklistRecord | null;
  onClose: () => void;
  onRemove?: (item: BlocklistRecord) => void;
}) {
  const date = item ? new Date(item.date) : null;
  return (
    <Drawer open={!!item} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DrawerContent>
        {item && (
          <>
            <DrawerHeader className="text-left">
              <Badge
                variant="secondary"
                className="w-fit text-[10px] px-2 py-0.5 font-semibold bg-red-500/10 text-red-400 border-red-500/20"
              >
                BLOCKLISTED
              </Badge>
              <DrawerTitle className="text-sm break-all leading-snug mt-1">{item.sourceTitle}</DrawerTitle>
              <p className="text-xs text-muted-foreground">{mediaTitle(item)}</p>
            </DrawerHeader>

            <div className="px-4 space-y-4 pb-6 overflow-y-auto flex-1 min-h-0">
              {item.message && (
                <div className="rounded-lg bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground mb-1">Message</p>
                  <p className="text-sm break-words">{item.message}</p>
                </div>
              )}

              <div>
                <h3 className="font-semibold text-sm mb-2">Information</h3>
                <div className="space-y-0 rounded-lg border divide-y">
                  <InfoRow label="Quality" value={item.quality?.quality?.name || '-'} />
                  <InfoRow label="Indexer" value={item.indexer || '-'} />
                  <InfoRow label="Protocol" value={item.protocol || '-'} />
                  <InfoRow
                    label="Date"
                    value={date && !Number.isNaN(date.getTime()) ? `${formatDateTime(date)} (${timeAgo(item.date)})` : '-'}
                  />
                  <InfoRow label="Instance" value={withAppName(item.instanceLabel, item.source)} />
                </div>
              </div>

              {onRemove && (
                <Button variant="destructive" className="w-full h-11" onClick={() => onRemove(item)}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Remove from blocklist
                </Button>
              )}
            </div>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs text-right max-w-[60%] break-words">{value}</span>
    </div>
  );
}
