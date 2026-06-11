'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
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
 * approved (it then appears in Seerr).
 */
export function PendingApprovalSection({ onChanged }: { onChanged?: () => void }) {
  const canApprove = useCan('requests.approve');
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [modalRow, setModalRow] = useState<PendingRow | null>(null);
  const [focusHandled, setFocusHandled] = useState(false);
  // Deep-link target from a `requestCreated` notification tap (?focus=<pendingId>)
  // — auto-opens the approve sheet for that row once.
  const focusId = useSearchParams().get('focus');

  const fetchPage = useCallback(async (skip: number, take: number) => {
    const res = await fetch(`/api/seerr/pending-requests?skip=${skip}&take=${take}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { results: PendingRow[]; pageInfo?: { results?: number } };
    return { results: data.results ?? [], total: data.pageInfo?.results ?? 0 };
  }, []);
  const getId = useCallback((r: PendingRow) => r.id, []);
  const { items: rows, total, loading, loadingMore, hasMore, loadMore, reload, removeItem } =
    useInfiniteScroll<PendingRow>({ fetchPage, getId, take: 20 });

  // Walk pages until the deep-linked row surfaces (it may be beyond page 1),
  // then open the approve sheet. One-shot — gives up once pages are exhausted.
  useEffect(() => {
    if (focusHandled || !focusId || loading) return;
    const row = rows.find((r) => r.id === focusId);
    if (row) {
      if (canApprove) setModalRow(row);
      setFocusHandled(true);
    } else if (hasMore && !loadingMore) {
      loadMore();
    } else if (!hasMore) {
      setFocusHandled(true);
    }
  }, [focusId, rows, canApprove, focusHandled, loading, loadingMore, hasMore, loadMore]);

  async function remove(id: string) {
    setBusy((p) => new Set(p).add(id));
    try {
      const res = await fetch(`/api/seerr/pending-requests/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        toast.error('Failed');
        return;
      }
      toast.success(canApprove ? 'Declined' : 'Cancelled');
      removeItem(id);
      onChanged?.();
    } finally {
      setBusy((p) => {
        const n = new Set(p);
        n.delete(id);
        return n;
      });
    }
  }

  if (rows.length === 0) return null;

  return (
    <div className="mb-4 space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Pending approval
      </h2>
      {rows.map((r) => {
        const Icon = r.mediaType === 'tv' ? Tv : Film;
        const isBusy = busy.has(r.id);
        return (
          <div
            key={r.id}
            className="flex items-center gap-3 rounded-lg border border-border bg-card p-2"
            style={{ opacity: isBusy ? 0.5 : 1 }}
          >
            <div className="flex h-14 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-muted text-muted-foreground">
              {r.posterUrl ? (
                <Image
                  src={r.posterUrl}
                  alt=""
                  width={40}
                  height={56}
                  unoptimized
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
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
