'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { FadeInImage } from '@/components/media/fade-in-image';
import {
  MoreHorizontal, Check, X, RefreshCw, Trash2, Film, Tv, Loader2,
  ExternalLink, MonitorPlay, Inbox, Pencil,
} from 'lucide-react';
import { toast } from 'sonner';
import { SeerrRequestModal } from '@/components/seerr/seerr-request-modal';
import { PendingApprovalSection } from '@/components/seerr/pending-approval-section';
import { useCan } from '@/components/permission-provider';
import { useBadgeActions } from '@/components/layout/badge-provider';
import { useExternalUrls } from '@/lib/hooks/use-external-urls';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { useElementSize } from '@/lib/widgets/use-element-size';
import { useListFetchSize } from '@/lib/widgets/use-list-fetch-size';
import { formatDistanceToNowSafe } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  QuickContextMenu,
  type ContextAction,
  type ContextActionGroup,
} from '@/components/ui/quick-context-menu';
import type { WidgetProps } from '@/lib/widgets/types';
import { SectionHeader } from './bento-primitives';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  SEERR_MEDIA_STATUS,
  SEERR_REQUEST_STATUS,
  type EnrichedSeerrRequest,
  type SeerrMediaType,
  type SeerrRequestFilter,
  type SeerrRequestSort,
  type SeerrSortDirection,
} from '@/types/seerr';

const ROW_HEIGHT = 64;
const DEFAULT_FETCH_SIZE = 30;
const UNBOUNDED_PAGE_SIZE = 50;
const LOAD_MORE_ROOT_MARGIN = '300px';
// Full-page mode: single column on phones, card grid on wider screens so the
// list uses the horizontal space instead of stretching rows across it.
const GRID_CLASS = 'grid grid-cols-1 gap-2 sm:gap-2.5 lg:grid-cols-2 2xl:grid-cols-3';

export interface RequestsListWidgetProps extends WidgetProps {
  filter?: SeerrRequestFilter;
  /** Seerr user id; forwarded as ?requestedBy= (approver API only). */
  requestedBy?: number | null;
  /** Empty = all types. When one type is set, forwarded as ?mediaType= server-side. */
  typeFilter?: SeerrMediaType[];
  sort?: SeerrRequestSort;
  sortDirection?: SeerrSortDirection;
  pageSize?: number;
  hideHeader?: boolean;
  /**
   * When true the widget renders every item it has loaded (no row cap) and
   * paginates further pages in as the user scrolls. Use on full-page views;
   * leave off for compact dashboard cells.
   */
  unbounded?: boolean;
}

interface ListResponse {
  pageInfo: { page: number; pages: number; pageSize: number; results: number };
  results: EnrichedSeerrRequest[];
}

async function fetchRequestsPage(
  filter: SeerrRequestFilter,
  take: number,
  skip: number,
  requestedBy: number | null | undefined,
  sort: SeerrRequestSort,
  sortDirection: SeerrSortDirection,
  mediaType?: SeerrMediaType,
): Promise<ListResponse> {
  const params = new URLSearchParams({
    take: String(take),
    skip: String(skip),
    filter,
    sort,
    sortDirection,
  });
  if (requestedBy != null) {
    params.set('requestedBy', String(requestedBy));
  }
  if (mediaType) {
    params.set('mediaType', mediaType);
  }
  const res = await fetch(`/api/seerr/requests?${params.toString()}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Failed (${res.status})`);
  }
  return (await res.json()) as ListResponse;
}

// Status → label + Tailwind color-pair (matches the amber/blue/rose/emerald
// tokens used elsewhere in the app, e.g. the requests tab badge and
// PendingApprovalSection).
function requestStatusBadge(status: number): { label: string; className: string } {
  if (status === SEERR_REQUEST_STATUS.PENDING_APPROVAL) return { label: 'Pending', className: 'bg-amber-500/15 text-amber-500' };
  if (status === SEERR_REQUEST_STATUS.APPROVED) return { label: 'Approved', className: 'bg-blue-500/15 text-blue-400' };
  if (status === SEERR_REQUEST_STATUS.DECLINED) return { label: 'Declined', className: 'bg-rose-500/15 text-rose-400' };
  if (status === SEERR_REQUEST_STATUS.FAILED) return { label: 'Failed', className: 'bg-rose-500/15 text-rose-400' };
  if (status === SEERR_REQUEST_STATUS.COMPLETED) return { label: 'Completed', className: 'bg-emerald-500/15 text-emerald-400' };
  return { label: `#${status}`, className: 'bg-muted text-muted-foreground' };
}

function mediaStatusBadge(status: number | undefined): { label: string; className: string } | null {
  if (!status) return null;
  if (status === SEERR_MEDIA_STATUS.AVAILABLE) return { label: 'Available', className: 'bg-emerald-500/15 text-emerald-400' };
  if (status === SEERR_MEDIA_STATUS.PARTIALLY_AVAILABLE) return { label: 'Partial', className: 'bg-emerald-500/15 text-emerald-400' };
  if (status === SEERR_MEDIA_STATUS.PROCESSING) return { label: 'Processing', className: 'bg-cyan-500/15 text-cyan-400' };
  if (status === SEERR_MEDIA_STATUS.PENDING) return { label: 'Queued', className: 'bg-muted text-muted-foreground' };
  if (status === SEERR_MEDIA_STATUS.DELETED) return { label: 'Deleted', className: 'bg-muted text-muted-foreground/70' };
  return null;
}

function requesterLabel(req: EnrichedSeerrRequest): string {
  const u = req.requestedBy;
  return (
    u?.displayName ??
    u?.username ??
    u?.plexUsername ??
    u?.jellyfinUsername ??
    u?.email ??
    `User ${u?.id ?? '?'}`
  );
}

function RequestDropdownItems({ groups }: { groups: ContextActionGroup[] }) {
  return groups.map((group, groupIndex) => (
    <Fragment key={group.id ?? groupIndex}>
      {groupIndex > 0 ? <DropdownMenuSeparator /> : null}
      {group.actions.map((action) => {
        const item = (
          <>
            {action.icon}
            <span>{action.label}</span>
            {action.external ? <ExternalLink size={11} className="ml-auto opacity-60" /> : null}
          </>
        );

        if (action.href) {
          return (
            <DropdownMenuItem key={action.id} asChild disabled={action.disabled || action.pending}>
              {action.external ? (
                <a href={action.href} target="_blank" rel="noopener noreferrer">
                  {item}
                </a>
              ) : (
                <Link href={action.href}>{item}</Link>
              )}
            </DropdownMenuItem>
          );
        }

        return (
          <DropdownMenuItem
            key={action.id}
            disabled={action.disabled || action.pending}
            variant={action.destructive ? 'destructive' : 'default'}
            onSelect={() => action.onSelect?.()}
          >
            {item}
          </DropdownMenuItem>
        );
      })}
    </Fragment>
  ));
}

export function RequestsListWidget({
  refreshInterval,
  editMode = false,
  filter: filterProp,
  requestedBy = null,
  typeFilter = [],
  sort = 'added',
  sortDirection = 'desc',
  pageSize,
  hideHeader = false,
  unbounded = false,
}: RequestsListWidgetProps) {
  const filter: SeerrRequestFilter = filterProp ?? 'pending';
  const serverMediaType = typeFilter.length === 1 ? typeFilter[0] : undefined;
  const externalUrls = useExternalUrls();
  const jellyfinExternal = externalUrls?.JELLYFIN ? externalUrls.JELLYFIN.replace(/\/+$/, '') : null;
  const seerrExternal = externalUrls?.SEERR ? externalUrls.SEERR.replace(/\/+$/, '') : null;
  const { ref, height } = useElementSize<HTMLDivElement>();
  const { visibleCount: maxItems } = useListFetchSize({
    height,
    rowHeight: ROW_HEIGHT,
    bucketSize: 5,
  });

  const take = unbounded
    ? UNBOUNDED_PAGE_SIZE
    : (pageSize ?? DEFAULT_FETCH_SIZE);

  // First page goes through useWidgetData so the cache + interval refresh
  // story keeps working for dashboard widget mode. Extra pages live in
  // component state below.
  const fetchFn = useCallback(
    () => fetchRequestsPage(filter, take, 0, requestedBy, sort, sortDirection, serverMediaType),
    [filter, take, requestedBy, sort, sortDirection, serverMediaType],
  );
  const { data, loading, error, refresh } = useWidgetData<ListResponse>({
    fetchFn,
    refreshInterval,
    enabled: !editMode,
    cacheKey: `seerr-requests-${filter}-${requestedBy ?? 'all'}-${serverMediaType ?? 'all'}-${sort}-${sortDirection}-${take}`,
  });

  const [extraPages, setExtraPages] = useState<EnrichedSeerrRequest[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  // Independent cursor — advances by the size of the fetched page, not by how
  // many rows we ended up rendering. If the upstream window shifts (a new
  // request slid in, pushing duplicates into our skip range), this still moves
  // forward instead of refetching the same offset forever.
  const skipRef = useRef(0);

  // Reset accumulated pages whenever the underlying query identity changes.
  useEffect(() => {
    setExtraPages([]);
    setExhausted(false);
    skipRef.current = 0;
  }, [filter, take, requestedBy, sort, sortDirection, serverMediaType]);

  const firstPageItems = useMemo<EnrichedSeerrRequest[]>(
    () => data?.results ?? [],
    [data]
  );
  const items = useMemo<EnrichedSeerrRequest[]>(() => {
    if (!unbounded) return firstPageItems;
    if (extraPages.length === 0) return firstPageItems;
    const seen = new Set(firstPageItems.map((r) => r.id));
    const dedupedExtras = extraPages.filter((r) => !seen.has(r.id));
    return [...firstPageItems, ...dedupedExtras];
  }, [firstPageItems, extraPages, unbounded]);

  const typeFilteredItems = useMemo(() => {
    if (typeFilter.length <= 1) return items;
    const allowed = new Set(typeFilter);
    return items.filter((r) => allowed.has(r.type));
  }, [items, typeFilter]);

  const totalResults = data?.pageInfo?.results ?? 0;
  const hasMore = unbounded && !exhausted && items.length < totalResults;

  const itemsLengthRef = useRef(items.length);
  itemsLengthRef.current = items.length;

  const loadMore = useCallback(async () => {
    if (!unbounded) return;
    if (loadingMore || exhausted) return;
    if (!data) return;
    // Use the larger of the cursor and the rendered count so we never refetch
    // an offset we've already crossed.
    const skip = Math.max(skipRef.current, itemsLengthRef.current);
    if (skip >= (data.pageInfo?.results ?? 0)) {
      setExhausted(true);
      return;
    }

    setLoadingMore(true);
    try {
      const next = await fetchRequestsPage(
        filter,
        take,
        skip,
        requestedBy,
        sort,
        sortDirection,
        serverMediaType,
      );
      let appended = 0;
      setExtraPages((prev) => {
        const seen = new Set<number>();
        for (const r of firstPageItems) seen.add(r.id);
        for (const r of prev) seen.add(r.id);
        const merged = [...prev];
        for (const r of next.results) {
          if (seen.has(r.id)) continue;
          seen.add(r.id);
          merged.push(r);
          appended++;
        }
        return merged;
      });
      skipRef.current = skip + next.results.length;
      if (next.results.length === 0 || appended === 0) {
        setExhausted(true);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load more');
    } finally {
      setLoadingMore(false);
    }
  }, [unbounded, loadingMore, exhausted, data, filter, take, requestedBy, sort, sortDirection, serverMediaType, firstPageItems]);

  // IntersectionObserver on a sentinel at the bottom of the list — fires
  // loadMore the moment the user scrolls within `LOAD_MORE_ROOT_MARGIN` of it.
  // root is null (viewport) in unbounded mode because the page itself scrolls;
  // pinning it to an inner element that doesn't actually scroll fires the
  // observer on mount and chains every page in without user interaction.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!unbounded || !hasMore) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadMore();
        }
      },
      {
        root: null,
        rootMargin: LOAD_MORE_ROOT_MARGIN,
      }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [unbounded, hasMore, loadMore]);

  const [busy, setBusy] = useState<Set<number>>(new Set());
  // Approve/edit open the full Seerr modal (overrides, seasons, Request As).
  const [modal, setModal] = useState<{ req: EnrichedSeerrRequest; mode: 'approve' | 'edit' } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EnrichedSeerrRequest | null>(null);
  // Only approvers see request-management actions (approve/decline/edit/retry/delete).
  const canManageRequests = useCan('requests.approve');
  const { adjustBadge } = useBadgeActions();

  const runAction = useCallback(
    async (id: number, action: 'approve' | 'decline' | 'retry' | 'delete') => {
      // Approving/declining/deleting a still-pending request clears one pending
      // approval, so the nav badge drops by 1. Retry leaves a failed request
      // failed, so it doesn't touch the count.
      const wasPending =
        action !== 'retry' &&
        items.find((r) => r.id === id)?.status === SEERR_REQUEST_STATUS.PENDING_APPROVAL;
      setBusy((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      try {
        const method = action === 'delete' ? 'DELETE' : 'POST';
        const path =
          action === 'delete'
            ? `/api/seerr/requests/${id}`
            : `/api/seerr/requests/${id}/${action}`;
        const res = await fetch(path, { method });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `${action} failed (${res.status})`);
        }
        const verbs: Record<typeof action, string> = {
          approve: 'Approved request',
          decline: 'Declined request',
          retry: 'Retrying request',
          delete: 'Deleted request',
        };
        toast.success(verbs[action]);
        if (wasPending) adjustBadge('requests', -1, -1);
        if (action === 'delete') {
          // Drop the row from any extra pages we'd already loaded so it doesn't
          // pop back in until the upstream refresh catches up.
          setExtraPages((prev) => prev.filter((r) => r.id !== id));
        }
        await refresh();
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Failed to ${action} request`);
        return false;
      } finally {
        setBusy((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [refresh, items, adjustBadge]
  );

  const header = hideHeader ? null : (
    <SectionHeader
      title="Requests"
      right={
        <Link href="/requests" style={{ color: 'inherit', textDecoration: 'none' }}>
          <span className="@max-[219px]/cell:hidden">View all </span>→
        </Link>
      }
    />
  );

  // Helprr-side pending requests (the approval gate). Renders above the Seerr
  // list in every state — including when there are no Seerr requests yet — and
  // returns null when there are none. Approving here refreshes the Seerr list.
  const pendingNode = (
    <PendingApprovalSection onChanged={refresh} grid={unbounded} contextMenuDisabled={editMode} />
  );

  // Shell: fills the bento cell height in widget mode (inner list scrolls);
  // grows with content in unbounded mode (the page itself scrolls).
  const shellClass = cn('flex min-h-0 flex-col', !unbounded && 'h-full');

  if (loading && items.length === 0) {
    return (
      <div ref={ref} className={shellClass}>
        {header}
        {pendingNode}
        {unbounded ? (
          <div className={GRID_CLASS} role="status" aria-busy="true" aria-label="Loading requests">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-border/60 bg-card p-3">
                <Skeleton className="h-14 w-10 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-2.5 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-1 items-start overflow-hidden py-1.5 text-[11px] text-muted-foreground">
            Loading…
          </div>
        )}
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div ref={ref} className={shellClass}>
        {header}
        {pendingNode}
        {unbounded ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-rose-400">{error}</div>
        ) : (
          <div className="flex flex-1 items-start overflow-hidden py-1.5 text-[11px] text-rose-400">{error}</div>
        )}
      </div>
    );
  }

  if (items.length === 0) {
    const emptyLabel = filter !== 'all' ? `No ${filter} requests` : 'No requests';
    return (
      <div ref={ref} className={shellClass}>
        {header}
        {pendingNode}
        {unbounded ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <Inbox className="h-6 w-6 opacity-50" />
            <p className="text-sm">{emptyLabel}</p>
          </div>
        ) : (
          <div className="flex flex-1 items-start overflow-hidden py-1.5 text-[11px] text-muted-foreground">
            {emptyLabel}
          </div>
        )}
      </div>
    );
  }

  if (typeFilteredItems.length === 0) {
    return (
      <div ref={ref} className={shellClass}>
        {header}
        {pendingNode}
        {unbounded ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <Inbox className="h-6 w-6 opacity-50" />
            <p className="text-sm">No matching requests</p>
          </div>
        ) : (
          <div className="flex flex-1 items-start overflow-hidden py-1.5 text-[11px] text-muted-foreground">
            No matching requests
          </div>
        )}
      </div>
    );
  }

  const visibleItems = unbounded ? typeFilteredItems : typeFilteredItems.slice(0, maxItems);

  return (
    <div ref={ref} className={shellClass}>
      {header}
      {pendingNode}
      <div
        className={cn(
          unbounded
            ? GRID_CLASS
            : 'no-scrollbar scroll-fade-y flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto'
        )}
      >
        {visibleItems.map((req) => {
          const reqBadge = requestStatusBadge(Number(req.status));
          const mediaBadge = mediaStatusBadge(Number(req.media?.status ?? 0));
          const title = req.enriched.title ?? `TMDB ${req.media?.tmdbId ?? req.id}`;
          const year = req.enriched.year;
          const poster = req.enriched.posterUrl;
          const Icon = req.type === 'tv' ? Tv : Film;
          const isBusy = busy.has(req.id);
          const canApprove = canManageRequests && Number(req.status) === SEERR_REQUEST_STATUS.PENDING_APPROVAL;
          const canDecline = canManageRequests && Number(req.status) === SEERR_REQUEST_STATUS.PENDING_APPROVAL;
          const canRetry = canManageRequests && Number(req.status) === SEERR_REQUEST_STATUS.FAILED;

          const helprrHref = req.enriched.helprr
            ? `/${req.enriched.helprr.type === 'series' ? 'series' : 'movies'}/${req.enriched.helprr.id}?instance=${req.enriched.helprr.instanceId}`
            : null;
          const jellyfinHref =
            jellyfinExternal && req.media?.jellyfinMediaId
              ? `${jellyfinExternal}/web/index.html#!/details?id=${req.media.jellyfinMediaId}`
              : null;
          const seerrHref =
            seerrExternal && req.media?.tmdbId
              ? `${seerrExternal}/${req.type === 'tv' ? 'tv' : 'movie'}/${req.media.tmdbId}`
              : null;
          const openActions: ContextAction[] = [
            ...(helprrHref ? [{
              id: 'open-helprr',
              label: 'Open in Helprr',
              icon: req.enriched.helprr?.type === 'series' ? <Tv size={14} /> : <Film size={14} />,
              href: helprrHref,
            }] : []),
            ...(jellyfinHref ? [{
              id: 'open-jellyfin',
              label: 'Open in Jellyfin',
              icon: <MonitorPlay size={14} />,
              href: jellyfinHref,
              external: true,
            }] : []),
            ...(seerrHref ? [{
              id: 'open-seerr',
              label: 'Open in Seerr',
              icon: <Inbox size={14} />,
              href: seerrHref,
              external: true,
            }] : []),
          ];
          const manageActions: ContextAction[] = [
            ...(canApprove ? [{
              id: 'approve',
              label: 'Approve…',
              icon: <Check size={14} />,
              onSelect: () => setModal({ req, mode: 'approve' as const }),
            }, {
              id: 'edit',
              label: 'Edit Request',
              icon: <Pencil size={14} />,
              onSelect: () => setModal({ req, mode: 'edit' as const }),
            }] : []),
            ...(canDecline ? [{
              id: 'decline',
              label: 'Decline',
              icon: <X size={14} />,
              onSelect: () => void runAction(req.id, 'decline'),
            }] : []),
            ...(canRetry ? [{
              id: 'retry',
              label: 'Retry',
              icon: <RefreshCw size={14} />,
              onSelect: () => void runAction(req.id, 'retry'),
            }] : []),
          ];
          const actionGroups: ContextActionGroup[] = [
            ...(openActions.length > 0 ? [{ id: 'open', actions: openActions }] : []),
            ...(manageActions.length > 0 ? [{ id: 'manage', actions: manageActions }] : []),
            ...(canManageRequests ? [{
              id: 'danger',
              actions: [{
                id: 'delete',
                label: 'Delete…',
                icon: <Trash2 size={14} />,
                destructive: true,
                onSelect: () => setDeleteTarget(req),
              }],
            }] : []),
          ];
          return (
            <QuickContextMenu
              key={req.id}
              label={`Actions for ${title}`}
              groups={actionGroups}
              disabled={editMode || isBusy}
            >
              <div
                className={cn(
                  'flex border transition-opacity',
                  unbounded
                    ? 'items-center gap-3 rounded-xl border-border/60 bg-card p-2.5 hover:bg-accent/40 sm:p-3'
                    : 'gap-2 rounded-lg border-[color:var(--hpr-hairline)] bg-[color:var(--hpr-ink)] p-2',
                  isBusy && 'pointer-events-none opacity-50'
                )}
              >
              <div
                className={cn(
                  'relative shrink-0 overflow-hidden rounded-md bg-muted',
                  unbounded ? 'h-14 w-10 sm:h-16 sm:w-11' : 'h-12 w-9 @max-[159px]/cell:hidden'
                )}
              >
                {poster ? (
                  <FadeInImage
                    src={poster}
                    alt=""
                    fill
                    sizes="44px"
                    className="object-cover"
                    // Tiny TMDB-CDN thumbnail — skip Next's optimizer (matches PendingApprovalSection).
                    unoptimized
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <Icon className="h-4 w-4" />
                  </div>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex min-w-0 items-baseline justify-between gap-2">
                  <span className={cn('min-w-0 truncate font-medium text-foreground', unbounded ? 'text-sm' : 'text-xs')}>
                    {title}
                    {year ? <span className="font-normal text-muted-foreground"> · {year}</span> : null}
                  </span>
                  {/* Full "13 days ago" on regular cells, "13 days" on compact, gone on tiny. */}
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground @max-[219px]/cell:hidden">
                    {formatDistanceToNowSafe(req.createdAt)}
                  </span>
                  <span className="hidden shrink-0 text-[10px] tabular-nums text-muted-foreground @max-[219px]/cell:inline @max-[159px]/cell:hidden">
                    {formatDistanceToNowSafe(req.createdAt).replace(/ ago$/, '')}
                  </span>
                </div>
                {/* Badges wrap onto extra lines on compact cells instead of clipping. */}
                <div className="flex min-w-0 items-center gap-1.5 overflow-hidden text-[10px] text-muted-foreground @max-[219px]/cell:flex-wrap">
                  <span className={cn('shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 font-medium', reqBadge.className)}>
                    {reqBadge.label}
                  </span>
                  {mediaBadge ? (
                    <span className={cn('shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 font-medium', mediaBadge.className)}>
                      {mediaBadge.label}
                    </span>
                  ) : null}
                  <span className="min-w-0 truncate @max-[219px]/cell:hidden">{requesterLabel(req)}</span>
                </div>
              </div>
              {/* Desktop quick actions — the extra width fits the two most
                  common actions inline; everything else stays in the menu. */}
              {!editMode && unbounded && canApprove ? (
                <div className="hidden shrink-0 items-center gap-0.5 lg:flex">
                  <button
                    type="button"
                    aria-label="Approve request"
                    title="Approve"
                    disabled={isBusy}
                    onClick={() => setModal({ req, mode: 'approve' })}
                    className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-emerald-500/15 hover:text-emerald-400 disabled:cursor-wait disabled:opacity-50"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Decline request"
                    title="Decline"
                    disabled={isBusy}
                    onClick={() => void runAction(req.id, 'decline')}
                    className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-rose-500/15 hover:text-rose-400 disabled:cursor-wait disabled:opacity-50"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : null}
              {editMode ? null : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Request actions"
                      disabled={isBusy}
                      className="flex shrink-0 items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-wait disabled:opacity-50"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <RequestDropdownItems groups={actionGroups} />
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              </div>
            </QuickContextMenu>
          );
        })}

        {unbounded && hasMore ? (
          <div
            ref={sentinelRef}
            className="col-span-full flex items-center justify-center gap-1.5 py-3 text-xs text-muted-foreground"
          >
            {loadingMore ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading more…
              </>
            ) : (
              <span>Scroll for more · {typeFilteredItems.length}/{totalResults}</span>
            )}
          </div>
        ) : null}

        {unbounded && !hasMore && totalResults > 0 ? (
          <div className="col-span-full py-2 text-center text-[11px] text-muted-foreground/70">
            All {totalResults} requests loaded
          </div>
        ) : null}
      </div>

      {modal && (
        <SeerrRequestModal
          open
          onOpenChange={(o) => {
            if (!o) setModal(null);
          }}
          mode={modal.mode}
          mediaType={modal.req.type}
          tmdbId={modal.req.media?.tmdbId ?? 0}
          title={modal.req.enriched.title ?? ''}
          requestId={modal.req.id}
          initialSeasons={modal.req.seasons?.map((s) => s.seasonNumber)}
          initialProfileId={modal.req.profileId ?? null}
          initialRootFolder={modal.req.rootFolder ?? null}
          initialTags={modal.req.tags}
          initialRequestedById={modal.req.requestedBy?.id ?? null}
          onDone={() => {
            setModal(null);
            void refresh();
          }}
        />
      )}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !(deleteTarget && busy.has(deleteTarget.id))) setDeleteTarget(null);
        }}
        title="Delete request?"
        description={deleteTarget
          ? `Delete the request for ${deleteTarget.enriched.title ?? `TMDB ${deleteTarget.media?.tmdbId ?? deleteTarget.id}`}? This cannot be undone.`
          : undefined}
        confirmLabel="Delete request"
        destructive
        busy={deleteTarget ? busy.has(deleteTarget.id) : false}
        onConfirm={async () => {
          if (!deleteTarget) return;
          const deleted = await runAction(deleteTarget.id, 'delete');
          if (deleted) setDeleteTarget(null);
        }}
      />
    </div>
  );
}
