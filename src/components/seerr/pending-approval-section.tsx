'use client';

import { useCallback, useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '@/lib/query-fetch';
import { handleAuthError } from '@/lib/query-client';
import { useSearchParams } from 'next/navigation';
import { FadeInImage } from '@/components/media/fade-in-image';
import { Check, X, Loader2, Film, Tv, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useCan } from '@/components/permission-provider';
import { SeerrRequestModal } from '@/components/seerr/seerr-request-modal';
import { useInfiniteScroll } from '@/lib/hooks/use-infinite-scroll';

interface PendingRow {
  id: string;
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  title: string | null;
  year: number | null;
  posterUrl: string | null;
  is4k: boolean;
  seasons: number[] | null;
  profileId: number | null;
  rootFolder: string | null;
  tags: number[] | null;
  seerrUserId: string | null;
  createdAt: string;
  requester: { id: string; displayName: string } | null;
}

/**
 * Helprr-side requests awaiting admin approval (the gate). Admins get
 * Approve…/Decline; members see their own pending rows with Cancel. Hidden when
 * empty. `onChanged` lets the parent refresh the Seerr list once an item is
 * approved (it then appears in Seerr). `grid` lays rows out as a responsive
 * card grid — only for full-page views; dashboard cells are too narrow.
 */
export function PendingApprovalSection({ onChanged, grid = false }: { onChanged?: () => void; grid?: boolean }) {
  const canApprove = useCan('requests.approve');
  const [modalRow, setModalRow] = useState<PendingRow | null>(null);
  // Keyed by focus id (not a boolean) so a second notification tap with a
  // different ?focus= on the already-mounted page is still handled.
  const [handledFocusId, setHandledFocusId] = useState<string | null>(null);
  // Deep-link target from a `requestCreated` notification tap (?focus=<pendingId>)
  // — auto-opens the approve sheet for that row once.
  const focusId = useSearchParams().get('focus');

  const fetchPage = useCallback(async (skip: number, take: number) => {
    const res = await fetch(`/api/seerr/pending-requests?skip=${skip}&take=${take}`);
    if (!res.ok) {
      // useInfiniteScroll swallows the error locally, so honor the 401→/login
      // redirect invariant here before re-throwing.
      if (res.status === 401) handleAuthError(new ApiError(401, 'Session expired'));
      throw new ApiError(res.status, `HTTP ${res.status}`);
    }
    const data = (await res.json()) as { results: PendingRow[]; pageInfo?: { results?: number } };
    return { results: data.results ?? [], total: data.pageInfo?.results ?? 0 };
  }, []);
  const getId = useCallback((r: PendingRow) => r.id, []);
  const { items: rows, total, loading, loadingMore, hasMore, loadMore, reload, removeItem } =
    useInfiniteScroll<PendingRow>({ fetchPage, getId, take: 20 });

  // Walk pages until the deep-linked row surfaces (it may be beyond page 1),
  // then open the approve sheet. One-shot — gives up once pages are exhausted.
  // The open/give-up decision runs during render (guarded); the effect below
  // only drives the paging side effect while the row hasn't surfaced.
  if (focusId && handledFocusId !== focusId && !loading) {
    const row = rows.find((r) => r.id === focusId);
    if (row) {
      if (canApprove) setModalRow(row);
      setHandledFocusId(focusId);
    } else if (!hasMore) {
      setHandledFocusId(focusId);
    }
  }

  useEffect(() => {
    if (!focusId || handledFocusId === focusId || loading || loadingMore || !hasMore) return;
    if (!rows.some((r) => r.id === focusId)) loadMore();
  }, [focusId, rows, handledFocusId, loading, loadingMore, hasMore, loadMore]);

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/seerr/pending-requests/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new ApiError(res.status, 'Failed');
    },
    onSuccess: (_data, id) => {
      toast.success(canApprove ? 'Declined' : 'Cancelled');
      removeItem(id);
      onChanged?.();
    },
    onError: (err) => {
      // 401 is handled globally (redirect to /login); only toast other failures.
      if (err instanceof ApiError && err.status === 401) return;
      toast.error('Failed');
    },
  });
  function remove(id: string) {
    removeMutation.mutate(id);
  }

  if (rows.length === 0) return null;

  return (
    <div className="mb-4 space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Pending approval
      </h2>
      {/* Single column on phones, card grid on wider screens (matches the requests list). */}
      <div className={grid ? 'grid grid-cols-1 gap-2 lg:grid-cols-2 2xl:grid-cols-3' : 'space-y-2'}>
      {rows.map((r) => {
        const Icon = r.mediaType === 'tv' ? Tv : Film;
        const isBusy = removeMutation.isPending && removeMutation.variables === r.id;
        return (
          <div
            key={r.id}
            className="flex items-center gap-3 rounded-lg border border-border bg-card p-2"
            style={{ opacity: isBusy ? 0.5 : 1 }}
          >
            <div className="flex h-14 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-muted text-muted-foreground">
              {r.posterUrl ? (
                <FadeInImage
                  src={r.posterUrl}
                  alt=""
                  width={40}
                  height={56}
                  unoptimized
                  className="w-full h-full object-cover"
                />
              ) : (
                <Icon className="h-4 w-4" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {r.title ?? `TMDB ${r.tmdbId}`}
                {r.year ? ` (${r.year})` : ''}
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {canApprove && r.requester ? `${r.requester.displayName} · ` : ''}
                {r.mediaType === 'tv' ? 'Series' : 'Movie'}
                {r.seasons && r.seasons.length
                  ? ` · ${r.seasons.length} season${r.seasons.length === 1 ? '' : 's'}`
                  : ''}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {canApprove ? (
                <>
                  <Button size="sm" className="h-8" disabled={isBusy} onClick={() => setModalRow(r)}>
                    <Check className="mr-1 h-4 w-4" /> Approve…
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-destructive hover:text-destructive"
                    disabled={isBusy}
                    onClick={() => void remove(r.id)}
                  >
                    {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="mr-1 h-4 w-4" />}
                    Decline
                  </Button>
                </>
              ) : (
                <>
                  <span className="text-xs text-amber-500">Awaiting approval</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    disabled={isBusy}
                    onClick={() => void remove(r.id)}
                  >
                    Cancel
                  </Button>
                </>
              )}
            </div>
          </div>
        );
      })}
      </div>

      {hasMore && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={loadingMore}
          onClick={() => loadMore()}
        >
          {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : `Load more (${rows.length} of ${total})`}
        </Button>
      )}

      {modalRow && (
        <SeerrRequestModal
          open
          onOpenChange={(o) => {
            if (!o) setModalRow(null);
          }}
          mode="approve-pending"
          mediaType={modalRow.mediaType}
          tmdbId={modalRow.tmdbId}
          title={modalRow.title ?? ''}
          pendingId={modalRow.id}
          initialSeasons={modalRow.seasons ?? undefined}
          initialProfileId={modalRow.profileId}
          initialRootFolder={modalRow.rootFolder}
          initialTags={modalRow.tags ?? undefined}
          initialRequestedById={modalRow.seerrUserId ? Number(modalRow.seerrUserId) : null}
          onDone={() => {
            setModalRow(null);
            reload();
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}
