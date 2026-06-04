'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
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
import type { WidgetProps } from '@/lib/widgets/types';
import { HPR, SectionHeader, mix, FONT_MONO } from './bento-primitives';
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
  type SeerrRequestFilter,
} from '@/types/seerr';

const ROW_HEIGHT = 64;
const DEFAULT_FETCH_SIZE = 30;
const UNBOUNDED_PAGE_SIZE = 50;
const LOAD_MORE_ROOT_MARGIN = '300px';

export interface RequestsListWidgetProps extends WidgetProps {
  filter?: SeerrRequestFilter;
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
  skip: number
): Promise<ListResponse> {
  const params = new URLSearchParams({
    take: String(take),
    skip: String(skip),
    filter,
    sort: 'added',
    sortDirection: 'desc',
  });
  const res = await fetch(`/api/seerr/requests?${params.toString()}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Failed (${res.status})`);
  }
  return (await res.json()) as ListResponse;
}

function requestStatusLabel(status: number): { label: string; color: string } {
  if (status === SEERR_REQUEST_STATUS.PENDING_APPROVAL) return { label: 'Pending', color: HPR.amber };
  if (status === SEERR_REQUEST_STATUS.APPROVED) return { label: 'Approved', color: HPR.blue };
  if (status === SEERR_REQUEST_STATUS.DECLINED) return { label: 'Declined', color: HPR.rose };
  if (status === SEERR_REQUEST_STATUS.FAILED) return { label: 'Failed', color: HPR.rose };
  if (status === SEERR_REQUEST_STATUS.COMPLETED) return { label: 'Completed', color: HPR.green };
  return { label: `#${status}`, color: HPR.fgMute };
}

function mediaStatusLabel(status: number | undefined): { label: string; color: string } | null {
  if (!status) return null;
  if (status === SEERR_MEDIA_STATUS.AVAILABLE) return { label: 'Available', color: HPR.green };
  if (status === SEERR_MEDIA_STATUS.PARTIALLY_AVAILABLE) return { label: 'Partial', color: HPR.green };
  if (status === SEERR_MEDIA_STATUS.PROCESSING) return { label: 'Processing', color: HPR.cyan };
  if (status === SEERR_MEDIA_STATUS.PENDING) return { label: 'Queued', color: HPR.fgMute };
  if (status === SEERR_MEDIA_STATUS.DELETED) return { label: 'Deleted', color: HPR.fgSubtle };
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

export function RequestsListWidget({
  refreshInterval,
  editMode = false,
  filter: filterProp,
  pageSize,
  hideHeader = false,
  unbounded = false,
}: RequestsListWidgetProps) {
  const filter: SeerrRequestFilter = filterProp ?? 'pending';
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
  const fetchFn = useCallback(() => fetchRequestsPage(filter, take, 0), [filter, take]);
  const { data, loading, error, refresh } = useWidgetData<ListResponse>({
    fetchFn,
    refreshInterval,
    enabled: !editMode,
    cacheKey: `seerr-requests-${filter}-${take}`,
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
  }, [filter, take]);

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
      const next = await fetchRequestsPage(filter, take, skip);
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
  }, [unbounded, loadingMore, exhausted, data, filter, take, firstPageItems]);

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
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Failed to ${action} request`);
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
          View all →
        </Link>
      }
    />
  );

  // Helprr-side pending requests (the approval gate). Renders above the Seerr
  // list in every state — including when there are no Seerr requests yet — and
  // returns null when there are none. Approving here refreshes the Seerr list.
  const pendingNode = <PendingApprovalSection onChanged={refresh} />;

  if (loading && items.length === 0) {
    return (
      <div ref={ref} style={shellStyle}>
        {header}
        {pendingNode}
        <div style={emptyShellStyle}>
          <span style={{ fontSize: 11, color: HPR.fgSubtle }}>Loading…</span>
        </div>
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div ref={ref} style={shellStyle}>
        {header}
        {pendingNode}
        <div style={emptyShellStyle}>
          <span style={{ fontSize: 11, color: HPR.rose }}>{error}</span>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div ref={ref} style={shellStyle}>
        {header}
        {pendingNode}
        <div style={emptyShellStyle}>
          <span style={{ fontSize: 11, color: HPR.fgSubtle }}>
            No {filter !== 'all' ? filter : ''} requests
          </span>
        </div>
      </div>
    );
  }

  const visibleItems = unbounded ? items : items.slice(0, maxItems);

  return (
    <div ref={ref} style={shellStyle}>
      {header}
      {pendingNode}
      <div
        className="no-scrollbar scroll-fade-y"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
        }}
      >
        {visibleItems.map((req) => {
          const reqBadge = requestStatusLabel(Number(req.status));
          const mediaBadge = mediaStatusLabel(Number(req.media?.status ?? 0));
          const title = req.enriched.title ?? `TMDB ${req.media?.tmdbId ?? req.id}`;
          const year = req.enriched.year;
          const poster = req.enriched.posterUrl;
          const Icon = req.type === 'tv' ? Tv : Film;
          const isBusy = busy.has(req.id);
          const canApprove = canManageRequests && Number(req.status) === SEERR_REQUEST_STATUS.PENDING_APPROVAL;
          const canDecline = canManageRequests && Number(req.status) === SEERR_REQUEST_STATUS.PENDING_APPROVAL;
          const canRetry = canManageRequests && Number(req.status) === SEERR_REQUEST_STATUS.FAILED;

          const helprrHref = req.enriched.helprr
            ? `/${req.enriched.helprr.type === 'series' ? 'series' : 'movies'}/${req.enriched.helprr.id}`
            : null;
          const jellyfinHref =
            jellyfinExternal && req.media?.jellyfinMediaId
              ? `${jellyfinExternal}/web/index.html#!/details?id=${req.media.jellyfinMediaId}`
              : null;
          const seerrHref =
            seerrExternal && req.media?.tmdbId
              ? `${seerrExternal}/${req.type === 'tv' ? 'tv' : 'movie'}/${req.media.tmdbId}`
              : null;
          const hasOpenLink = !!(helprrHref || jellyfinHref || seerrHref);
          const hasActionAboveDelete = canApprove || canDecline || canRetry;
          return (
            <div
              key={req.id}
              style={{
                display: 'flex',
                gap: 8,
                padding: 8,
                background: HPR.ink,
                border: `1px solid ${HPR.hairline}`,
                borderRadius: 6,
                opacity: isBusy ? 0.5 : 1,
                transition: 'opacity 0.15s ease',
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 48,
                  borderRadius: 4,
                  background: mix(HPR.fg, 4),
                  flexShrink: 0,
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: HPR.fgMute,
                }}
              >
                {poster ? (
                  <Image
                    src={poster}
                    alt=""
                    width={36}
                    height={48}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    unoptimized
                  />
                ) : (
                  <Icon size={16} />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, justifyContent: 'space-between' }}>
                  <span
                    style={{
                      fontSize: 12,
                      color: HPR.fg,
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {title}
                    {year ? <span style={{ color: HPR.fgSubtle, fontWeight: 400 }}> · {year}</span> : null}
                  </span>
                  <span
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 9,
                      color: HPR.fgSubtle,
                      flexShrink: 0,
                    }}
                  >
                    {formatDistanceToNowSafe(req.createdAt)}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: HPR.fgMute }}>
                  <span
                    style={{
                      padding: '1px 6px',
                      borderRadius: 4,
                      background: mix(reqBadge.color, 14),
                      color: reqBadge.color,
                      fontWeight: 500,
                    }}
                  >
                    {reqBadge.label}
                  </span>
                  {mediaBadge ? (
                    <span
                      style={{
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: mix(mediaBadge.color, 14),
                        color: mediaBadge.color,
                        fontWeight: 500,
                      }}
                    >
                      {mediaBadge.label}
                    </span>
                  ) : null}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {requesterLabel(req)}
                  </span>
                </div>
              </div>
              {editMode ? null : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Request actions"
                      disabled={isBusy}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: HPR.fgMute,
                        cursor: isBusy ? 'wait' : 'pointer',
                        padding: 4,
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <MoreHorizontal size={16} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {helprrHref ? (
                      <DropdownMenuItem asChild>
                        <Link href={helprrHref}>
                          {req.enriched.helprr?.type === 'series' ? (
                            <Tv size={14} />
                          ) : (
                            <Film size={14} />
                          )}{' '}
                          Open in Helprr
                        </Link>
                      </DropdownMenuItem>
                    ) : null}
                    {jellyfinHref ? (
                      <DropdownMenuItem asChild>
                        <a
                          href={jellyfinHref}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <MonitorPlay size={14} /> Open in Jellyfin
                          <ExternalLink size={11} style={{ marginLeft: 'auto', opacity: 0.6 }} />
                        </a>
                      </DropdownMenuItem>
                    ) : null}
                    {seerrHref ? (
                      <DropdownMenuItem asChild>
                        <a
                          href={seerrHref}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Inbox size={14} /> Open in Seerr
                          <ExternalLink size={11} style={{ marginLeft: 'auto', opacity: 0.6 }} />
                        </a>
                      </DropdownMenuItem>
                    ) : null}
                    {hasOpenLink ? <DropdownMenuSeparator /> : null}
                    {canApprove ? (
                      <DropdownMenuItem onClick={() => setModal({ req, mode: 'approve' })}>
                        <Check size={14} /> Approve…
                      </DropdownMenuItem>
                    ) : null}
                    {canApprove ? (
                      <DropdownMenuItem onClick={() => setModal({ req, mode: 'edit' })}>
                        <Pencil size={14} /> Edit Request
                      </DropdownMenuItem>
                    ) : null}
                    {canDecline ? (
                      <DropdownMenuItem onClick={() => void runAction(req.id, 'decline')}>
                        <X size={14} /> Decline
                      </DropdownMenuItem>
                    ) : null}
                    {canRetry ? (
                      <DropdownMenuItem onClick={() => void runAction(req.id, 'retry')}>
                        <RefreshCw size={14} /> Retry
                      </DropdownMenuItem>
                    ) : null}
                    {hasActionAboveDelete && canManageRequests ? <DropdownMenuSeparator /> : null}
                    {canManageRequests ? (
                    <DropdownMenuItem
                      onClick={() => void runAction(req.id, 'delete')}
                      style={{ color: 'var(--destructive)' }}
                    >
                      <Trash2 size={14} /> Delete
                    </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          );
        })}

        {unbounded && hasMore ? (
          <div
            ref={sentinelRef}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              padding: '12px 0 4px',
              color: HPR.fgSubtle,
              fontSize: 11,
              fontFamily: FONT_MONO,
            }}
          >
            {loadingMore ? (
              <>
                <Loader2 size={12} className="animate-spin" /> Loading more…
              </>
            ) : (
              <span>Scroll for more · {items.length}/{totalResults}</span>
            )}
          </div>
        ) : null}

        {unbounded && !hasMore && totalResults > 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '8px 0 4px',
              color: HPR.fgSubtle,
              fontSize: 10,
              fontFamily: FONT_MONO,
            }}
          >
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
    </div>
  );
}

const shellStyle = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
} as const;

// Empty/loading/error states fill the remaining height with overflow:hidden so
// the widget cell never rubber-bands on iOS when there's nothing to scroll.
const emptyShellStyle = {
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
  display: 'flex',
  alignItems: 'flex-start',
  padding: '6px 0',
} as const;
