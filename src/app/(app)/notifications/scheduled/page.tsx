'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { format, formatDistanceToNow } from 'date-fns';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpDown,
  Bell,
  CalendarClock,
  Filter,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SearchInput } from '@/components/media/search-input';
import { PageSpinner } from '@/components/ui/page-spinner';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { useRefreshAction } from '@/lib/hooks/use-refresh-action';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScheduledAlertSummary } from '@/components/scheduled-alerts/scheduled-alert-summary';
import { ScheduledAlertDialog, type ScheduledAlertDraft } from '@/components/scheduled-alerts/scheduled-alert-dialog';
import { jsonFetcher } from '@/lib/query-fetch';
import { FadeInImage } from '@/components/media/fade-in-image';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import type { SerializedAlert } from '@/lib/scheduled-alerts/serialize';
import type { ReleaseKind } from '@/lib/scheduled-alerts/types';
import { useCan } from '@/components/permission-provider';

type SortKey = 'nextNotify' | 'title' | 'created';
type StatusFilter = 'all' | 'active' | 'upcoming' | 'sent' | 'failed' | 'cancelled';
type ModeFilter = 'all' | 'absolute' | 'release_relative';

interface ListResponse {
  page: number;
  pageSize: number;
  totalRecords: number;
  records: SerializedAlert[];
}

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'nextNotify', label: 'Next alert' },
  { value: 'title', label: 'Title' },
  { value: 'created', label: 'Date created' },
];

function statusBadge(status: string) {
  if (status === 'active') return <Badge className="text-[10px]">Active</Badge>;
  if (status === 'cancelled') return <Badge variant="secondary" className="text-[10px]">Cancelled</Badge>;
  return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
}

export default function ScheduledAlertsPage() {
  const router = useRouter();
  const canEdit = useCan('scheduledAlerts.edit');
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('nextNotify');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all');
  const [mediaTypeFilter, setMediaTypeFilter] = useState<string>('all');
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addDraft, setAddDraft] = useState<ScheduledAlertDraft | null>(null);
  const [editTarget, setEditTarget] = useState<SerializedAlert | null>(null);
  const [cancelTarget, setCancelTarget] = useState<SerializedAlert | null>(null);
  const [cancelOccurrence, setCancelOccurrence] = useState<{ alertId: string; occurrenceId: string; title: string } | null>(null);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const queryKey = useMemo(
    () => ['scheduled-alerts', { q: debouncedSearch, sort, statusFilter, modeFilter, mediaTypeFilter }] as const,
    [debouncedSearch, sort, statusFilter, modeFilter, mediaTypeFilter],
  );

  const listUrl = useMemo(() => {
    const params = new URLSearchParams({ pageSize: '50', sort, includeOccurrences: 'true' });
    if (debouncedSearch.trim()) params.set('q', debouncedSearch.trim());
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (modeFilter !== 'all') params.set('scheduleMode', modeFilter);
    if (mediaTypeFilter !== 'all') params.set('mediaType', mediaTypeFilter);
    return `/api/scheduled-alerts?${params.toString()}`;
  }, [debouncedSearch, sort, statusFilter, modeFilter, mediaTypeFilter]);

  const listQuery = useInfiniteQuery({
    queryKey: [...queryKey, listUrl],
    queryFn: async ({ pageParam }) => {
      const url = `${listUrl}&page=${pageParam}`;
      return jsonFetcher<ListResponse>(url)();
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page * lastPage.pageSize < lastPage.totalRecords ? lastPage.page + 1 : undefined,
  });

  const records = useMemo(
    () => listQuery.data?.pages.flatMap((page) => page.records) ?? [],
    [listQuery.data?.pages],
  );
  const totalRecords = listQuery.data?.pages[0]?.totalRecords ?? 0;
  const loading = listQuery.isLoading;
  const hasMore = listQuery.hasNextPage;

  const { refreshing, refresh } = useRefreshAction(() => listQuery.refetch());

  const hasActiveFilters =
    statusFilter !== 'active' || modeFilter !== 'all' || mediaTypeFilter !== 'all';

  const grouped = useMemo(() => {
    const groups = new Map<string, SerializedAlert[]>();
    for (const r of records) {
      const key = r.nextOccurrence
        ? format(new Date(r.nextOccurrence.notifyAt), 'yyyy-MM-dd')
        : 'none';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [records]);

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['scheduled-alerts'] });
  }, [queryClient]);

  async function cancelAlert(alert: SerializedAlert) {
    setCancelling(true);
    try {
      const res = await fetch(`/api/scheduled-alerts/${alert.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to cancel alert');
      toast.success('Alert cancelled');
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to cancel');
    } finally {
      setCancelling(false);
      setCancelTarget(null);
    }
  }

  async function cancelOneOccurrence(alertId: string, occurrenceId: string) {
    setCancelling(true);
    try {
      const res = await fetch(
        `/api/scheduled-alerts/${alertId}/occurrences/${occurrenceId}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error('Failed to cancel occurrence');
      toast.success('Occurrence cancelled');
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to cancel');
    } finally {
      setCancelling(false);
      setCancelOccurrence(null);
    }
  }

  return (
    <div className="space-y-3 animate-content-in pb-12">
      <PullToRefresh onRefresh={() => listQuery.refetch()} />
      <PageHeader
        showBack
        onBack={() => router.push('/notifications')}
        title="Scheduled Alerts"
        rightContent={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={refresh}
              disabled={refreshing}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-primary disabled:opacity-60 disabled:cursor-default"
              aria-label="Refresh alerts"
            >
              <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => setFilterDrawerOpen(true)}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-primary relative"
              aria-label="Filter alerts"
            >
              <Filter className="h-5 w-5" />
              {hasActiveFilters && (
                <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-primary" />
              )}
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={() => {
                  setAddDraft({
                    source: 'TMDB',
                    externalId:
                      typeof crypto !== 'undefined' && 'randomUUID' in crypto
                        ? `manual:${crypto.randomUUID()}`
                        : `manual:${Date.now()}`,
                    mediaType: 'movie',
                    title: 'Custom reminder',
                    href: null,
                  });
                  setAddOpen(true);
                }}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-primary"
                aria-label="Add alert"
              >
                <Plus className="h-5 w-5" />
              </button>
            )}
          </div>
        }
      />

      <div className="relative">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <SearchInput
          value={searchInput}
          onChange={setSearchInput}
          historyKey="scheduled-alerts"
          placeholder="Search scheduled alerts…"
          className="pl-9 pr-9 h-10"
        />
        {searchInput.length > 0 && (
          <button
            type="button"
            onClick={() => setSearchInput('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8">
              <ArrowUpDown data-icon="inline-start" />
              {SORT_OPTIONS.find((o) => o.value === sort)?.label}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              {SORT_OPTIONS.map((opt) => (
                <DropdownMenuRadioItem key={opt.value} value={opt.value}>
                  {opt.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Badge variant="secondary" className="text-xs">
          {totalRecords} alert{totalRecords === 1 ? '' : 's'}
        </Badge>
      </div>

      {loading ? (
        <PageSpinner />
      ) : listQuery.isError ? (
        <div className="text-center py-12 text-muted-foreground">
          <CalendarClock className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>Failed to load scheduled alerts</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void listQuery.refetch()}>
            Retry
          </Button>
        </div>
      ) : records.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <CalendarClock className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>{debouncedSearch || hasActiveFilters ? 'No alerts match your filters' : 'No scheduled alerts yet'}</p>
          {!debouncedSearch && !hasActiveFilters && canEdit && (
            <p className="text-xs mt-2">Add an alert from any movie, show, or anime page</p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {grouped.map(([dateKey, items]) => (
            <div key={dateKey}>
              {dateKey !== 'none' && (
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">
                  {format(new Date(`${dateKey}T00:00:00`), 'EEE, MMM d')}
                </p>
              )}
              <div className="flex flex-col gap-2">
                {items.map((alert) => {
                  const poster = alert.posterUrl
                    ? isProtectedApiImageSrc(alert.posterUrl)
                      ? toCachedImageSrc(alert.posterUrl)
                      : alert.posterUrl
                    : null;
                  return (
                    <div
                      key={alert.id}
                      className="flex items-start gap-3 rounded-lg border border-border/50 bg-card/40 p-3"
                    >
                      <div className="relative size-12 shrink-0 rounded-md overflow-hidden bg-muted">
                        {poster ? (
                          <FadeInImage
                            src={poster}
                            alt=""
                            fill
                            sizes="48px"
                            className="object-cover"
                            unoptimized={isProtectedApiImageSrc(poster)}
                          />
                        ) : (
                          <div className="size-full flex items-center justify-center">
                            <Bell className="h-4 w-4 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            {alert.href ? (
                              <Link href={alert.href} className="text-sm font-semibold truncate hover:underline block">
                                {alert.title}
                              </Link>
                            ) : (
                              <p className="text-sm font-semibold truncate">{alert.title}</p>
                            )}
                            {alert.subtitle && (
                              <p className="text-xs text-muted-foreground truncate">{alert.subtitle}</p>
                            )}
                          </div>
                          {statusBadge(alert.status)}
                        </div>
                        <div className="mt-1.5">
                          <ScheduledAlertSummary
                            scheduleMode={alert.scheduleMode}
                            releaseTypes={alert.releaseTypes}
                            offsetMinutes={alert.offsetMinutes}
                            releaseKindLabel={alert.nextOccurrence?.releaseKindLabel}
                          />
                        </div>
                        {alert.nextOccurrence && (
                          <p className="text-[11px] text-muted-foreground mt-1">
                            Next: {format(new Date(alert.nextOccurrence.notifyAt), 'MMM d, h:mm a')}
                            {' · '}
                            {formatDistanceToNow(new Date(alert.nextOccurrence.notifyAt), { addSuffix: true })}
                          </p>
                        )}
                      </div>
                      {canEdit && alert.status === 'active' && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="p-1.5 rounded-md text-muted-foreground hover:bg-muted"
                              aria-label="Alert actions"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setEditTarget(alert)}>
                              Edit alert
                            </DropdownMenuItem>
                            {alert.nextOccurrence && (
                              <DropdownMenuItem
                                onClick={() =>
                                  setCancelOccurrence({
                                    alertId: alert.id,
                                    occurrenceId: alert.nextOccurrence!.id,
                                    title: alert.title,
                                  })
                                }
                              >
                                Cancel next occurrence
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setCancelTarget(alert)}
                            >
                              <Trash2 data-icon="inline-start" />
                              Cancel all
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={listQuery.isFetchingNextPage}
                onClick={() => void listQuery.fetchNextPage()}
              >
                {listQuery.isFetchingNextPage ? 'Loading…' : 'Load more alerts'}
              </Button>
            </div>
          )}
        </div>
      )}

      <Drawer open={filterDrawerOpen} onOpenChange={setFilterDrawerOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Filter alerts</DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-2 flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase">Status</p>
              <div className="grid grid-cols-3 gap-1 p-1 rounded-md bg-muted/40">
                {(['all', 'active', 'upcoming', 'sent', 'failed', 'cancelled'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setStatusFilter(opt)}
                    className={`py-2 rounded text-xs font-medium capitalize transition-colors ${
                      statusFilter === opt ? 'bg-background shadow-sm' : 'text-muted-foreground'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase">Type</p>
              <div className="grid grid-cols-3 gap-1 p-1 rounded-md bg-muted/40">
                {(['all', 'release_relative', 'absolute'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setModeFilter(opt)}
                    className={`py-2 rounded text-[10px] font-medium transition-colors ${
                      modeFilter === opt ? 'bg-background shadow-sm' : 'text-muted-foreground'
                    }`}
                  >
                    {opt === 'all' ? 'All' : opt === 'absolute' ? 'Custom' : 'Release'}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase">Media</p>
              <div className="grid grid-cols-4 gap-1 p-1 rounded-md bg-muted/40">
                {(['all', 'movie', 'series', 'anime'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setMediaTypeFilter(opt)}
                    className={`py-2 rounded text-xs font-medium capitalize transition-colors ${
                      mediaTypeFilter === opt ? 'bg-background shadow-sm' : 'text-muted-foreground'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DrawerFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setStatusFilter('active');
                setModeFilter('all');
                setMediaTypeFilter('all');
              }}
            >
              Reset
            </Button>
            <Button onClick={() => setFilterDrawerOpen(false)}>Done</Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <ScheduledAlertDialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) setAddDraft(null);
        }}
        draft={addDraft}
        onSaved={invalidate}
        initialScheduleMode="absolute"
        allowTitleEdit
      />

      <ScheduledAlertDialog
        open={Boolean(editTarget)}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
        draft={
          editTarget
            ? {
                source: editTarget.source as ScheduledAlertDraft['source'],
                externalId: editTarget.externalId,
                mediaType: editTarget.mediaType as ScheduledAlertDraft['mediaType'],
                title: editTarget.title,
                subtitle: editTarget.subtitle,
                posterUrl: editTarget.posterUrl,
                href: editTarget.href,
                instanceId: editTarget.instanceId,
              }
            : null
        }
        alertId={editTarget?.id}
        initialScheduleMode={editTarget?.scheduleMode as 'absolute' | 'release_relative' | undefined}
        initialReleaseTypes={editTarget?.releaseTypes as ReleaseKind[] | undefined}
        initialOffsetMinutes={editTarget?.offsetMinutes}
        initialAbsoluteNotifyAt={
          editTarget?.scheduleMode === 'absolute'
            ? editTarget.nextOccurrence?.notifyAt ?? null
            : null
        }
        allowTitleEdit
        onSaved={() => {
          setEditTarget(null);
          invalidate();
        }}
      />

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        title="Cancel scheduled alert?"
        description={
          cancelTarget
            ? `This will cancel all future notifications for "${cancelTarget.title}".`
            : ''
        }
        confirmLabel="Cancel alert"
        destructive
        busy={cancelling}
        onConfirm={() => {
          if (cancelTarget) void cancelAlert(cancelTarget);
        }}
      />

      <ConfirmDialog
        open={Boolean(cancelOccurrence)}
        onOpenChange={(open) => !open && setCancelOccurrence(null)}
        title="Cancel this occurrence?"
        description={
          cancelOccurrence
            ? `Skip the next scheduled notification for "${cancelOccurrence.title}".`
            : ''
        }
        confirmLabel="Cancel occurrence"
        destructive
        busy={cancelling}
        onConfirm={() => {
          if (cancelOccurrence) {
            void cancelOneOccurrence(cancelOccurrence.alertId, cancelOccurrence.occurrenceId);
          }
        }}
      />
    </div>
  );
}
