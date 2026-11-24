'use client';

import { useRouteViewState } from '@/lib/hooks/use-route-view-state';

import { useEffect, useMemo, useState } from 'react';
import { useRestorableInfiniteQuery as useInfiniteQuery } from '@/lib/hooks/use-restorable-infinite-query';
import { keepPreviousData, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FloatingActionBar } from '@/components/ui/floating-action-bar';
import { PageSpinner } from '@/components/ui/page-spinner';
import { ListChecks, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { InstanceFilter, type InstanceOption, withAppName } from '@/components/instance-filter';
import { ActiveFilterBar, type ActiveFilter } from '@/components/ui/active-filter-bar';
import { useCan } from '@/components/permission-provider';
import {
  BlocklistDrawer,
  BlocklistRow,
  recordKey,
  removeEntries,
  type BlocklistRecord,
} from '@/components/media/blocklist-entry';

type BlocklistResponse = {
  records?: BlocklistRecord[];
  hasMore?: boolean;
  truncated?: boolean;
  partial?: boolean;
};

const BLOCKLIST_QUERY_PREFIX = ['activity', 'blocklist'] as const;

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

  // Same instance list (and query key) as the History page's filter; Lidarr only
  // with music.view, as the server leaves it out otherwise.
  const canViewMusic = useCan('music.view');
  const { data: instanceOptions = [], isSuccess: instancesLoaded } = useQuery({
    queryKey: queryKeys.arrInstances(),
    queryFn: jsonFetcher<Array<{ id: string; label: string; type: string }>>('/api/instances'),
    select: (conns): InstanceOption[] =>
      Array.isArray(conns)
        ? conns
          .filter((c) => c.type !== 'LIDARR' || canViewMusic)
          .map((c) => ({ id: c.id, label: withAppName(c.label, c.type) }))
        : [],
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    // Only against the loaded list: the empty default would drop a saved pick on a cold load.
    if (instancesLoaded && instanceFilter !== 'all' && !instanceOptions.some((i) => i.id === instanceFilter)) {
      setInstanceFilter('all');
    }
  }, [instancesLoaded, instanceOptions, instanceFilter, setInstanceFilter]);

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

      <div data-scroll-restoration-key="activity-blocklist" className="page-bleed flex-1 pb-4">
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
