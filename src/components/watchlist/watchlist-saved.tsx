'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import Link from '@/components/ui/app-link';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCan } from '@/components/permission-provider';
import { ApiError, jsonFetcher } from '@/lib/query-fetch';

/** The ids a title is known by, to find it on the watchlist however it was saved. */
export interface WatchlistMatchQuery {
  mediaType: 'movie' | 'series';
  tmdbId?: number | null;
  tvdbId?: number | null;
  /** Its Radarr/Sonarr id on each instance that has it (no instance: the default). */
  arr?: Array<{ instanceId?: string | null; id: number }>;
}

export interface WatchlistEntry {
  id: string;
  title: string;
}

export function watchlistMatchSearch(query: WatchlistMatchQuery): string | null {
  const params = new URLSearchParams({ mediaType: query.mediaType });
  if (query.tmdbId) params.set('tmdbId', String(query.tmdbId));
  if (query.tvdbId) params.set('tvdbId', String(query.tvdbId));
  for (const ref of query.arr ?? []) params.append('arr', `${ref.instanceId ?? ''}:${ref.id}`);
  return params.size > 1 ? params.toString() : null;
}

/** The person's watchlist entry for a title, or null (also while it loads). */
export function useWatchlistEntry(query: WatchlistMatchQuery | null): WatchlistEntry | null {
  const canView = useCan('watchlist.view');
  const search = query ? watchlistMatchSearch(query) : null;
  const { data } = useQuery({
    // Under ['watchlist'], so every watchlist change refreshes it.
    queryKey: ['watchlist', 'match', search],
    queryFn: jsonFetcher<{ item: WatchlistEntry | null }>(`/api/watchlist/match?${search}`),
    enabled: canView && search !== null,
    staleTime: 30_000,
  });
  return data?.item ?? null;
}

/** A saved title's bookmark: take it off the watchlist, or go to the watchlist. */
export function WatchlistSavedDialog({
  open,
  onOpenChange,
  entry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: WatchlistEntry | null;
}) {
  const canEdit = useCan('watchlist.edit');
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/watchlist/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new ApiError(res.status, err?.error ?? 'Failed to remove');
      }
    },
    onSuccess: async () => {
      toast.success('Removed from watchlist');
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: ['watchlist'] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) return;
      toast.error(err instanceof Error ? err.message : 'Failed to remove');
    },
  });

  return (
    <Dialog open={open && entry !== null} onOpenChange={(next) => { if (!remove.isPending) onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>On your watchlist</DialogTitle>
          <DialogDescription>{entry ? `${entry.title} is on your watchlist.` : ''}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {entry && canEdit && (
            <Button variant="outline" disabled={remove.isPending} onClick={() => remove.mutate(entry.id)}>
              {remove.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Remove from watchlist
            </Button>
          )}
          <Button asChild>
            <Link href="/watchlist">Open watchlist</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
