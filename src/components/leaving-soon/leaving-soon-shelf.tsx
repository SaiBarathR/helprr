'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Clock, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCan } from '@/components/permission-provider';
import { toCachedImageSrc } from '@/lib/image';
import { jsonOk } from '@/lib/http';

export interface LeavingSoonShelfItem {
  id: string;
  mediaType: 'movie' | 'series';
  instanceId: string;
  arrId: number;
  title: string;
  year: number | null;
  posterUrl: string | null;
  sizeBytes: number;
  markedAt: string;
  deleteAfter: string;
  reasons?: string[];
  requestedBy?: string[];
  lastWatchedAt?: string | null;
  markedByUsername?: string;
}

export const leavingSoonQueryKey = (type?: 'movie' | 'series') => ['leaving-soon', type ?? 'all'] as const;

export async function fetchLeavingSoon(type?: 'movie' | 'series'): Promise<LeavingSoonShelfItem[]> {
  const res = await fetch(type ? `/api/leaving-soon?type=${type}` : '/api/leaving-soon');
  const data = await jsonOk<{ items: LeavingSoonShelfItem[] }>(res);
  return data.items ?? [];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function countdownLabel(deleteAfter: string, now = Date.now()): string {
  const left = Date.parse(deleteAfter) - now;
  if (!Number.isFinite(left) || left <= 0) return 'Any day now';
  const days = Math.ceil(left / DAY_MS);
  return days === 1 ? 'Leaves in 1 day' : `Leaves in ${days} days`;
}

export function useKeepLeavingSoon() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (item: LeavingSoonShelfItem) => {
      const res = await fetch(`/api/leaving-soon/${encodeURIComponent(item.id)}/keep`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? 'Could not keep this title');
      }
      return item;
    },
    onSuccess: (item) => {
      toast.success(`Keeping ${item.title}`);
      void queryClient.invalidateQueries({ queryKey: ['leaving-soon'] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not keep this title'),
  });
}

/**
 * The "Leaving soon" shelf: titles an admin marked for library cleanup, with
 * their countdown and a Keep button. Renders nothing when there are none, so
 * it never adds a row to a page that has nothing leaving.
 */
export function LeavingSoonShelf({ type }: { type?: 'movie' | 'series' }) {
  const canMovies = useCan('movies.view');
  const canSeries = useCan('series.view');
  const allowed = type === 'movie' ? canMovies : type === 'series' ? canSeries : canMovies || canSeries;
  const { data } = useQuery({
    queryKey: leavingSoonQueryKey(type),
    queryFn: () => fetchLeavingSoon(type),
    enabled: allowed,
    staleTime: 60_000,
  });
  const keep = useKeepLeavingSoon();
  const [now] = useState(() => Date.now());
  const items = data ?? [];

  // The library pages measure where their virtualized grid starts on resize;
  // the shelf appearing or going moves it, so ask them to measure again.
  useEffect(() => {
    window.dispatchEvent(new Event('resize'));
  }, [items.length]);

  if (!allowed || items.length === 0) return null;

  return (
    <section aria-label="Leaving soon" className="mb-3 rounded-[10px] border border-border bg-card px-3 pt-2.5 pb-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Clock className="h-3.5 w-3.5 text-amber-400" aria-hidden />
        <span>Leaving soon</span>
        <span className="tabular-nums">· {items.length}</span>
      </div>
      <ul className="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1">
        {items.map((item) => {
          const href = `/${item.mediaType === 'movie' ? 'movies' : 'series'}/${item.arrId}?instance=${encodeURIComponent(item.instanceId)}`;
          const poster = toCachedImageSrc(item.posterUrl, item.mediaType === 'movie' ? 'radarr' : 'sonarr', { width: 240 });
          const pending = keep.isPending && keep.variables?.id === item.id;
          return (
            <li key={item.id} className="w-28 shrink-0 sm:w-32">
              <Link href={href} className="block">
                <div className="aspect-[2/3] overflow-hidden rounded-md bg-muted">
                  {poster && (
                    // eslint-disable-next-line @next/next/no-img-element -- proxied arr poster, like the library grids
                    <img src={poster} alt="" loading="lazy" className="h-full w-full object-cover" />
                  )}
                </div>
                <p className="mt-1.5 truncate text-sm font-medium" title={item.title}>{item.title}</p>
              </Link>
              <p className="text-xs text-amber-400">{countdownLabel(item.deleteAfter, now)}</p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="mt-1.5 h-9 w-full"
                disabled={pending}
                onClick={() => keep.mutate(item)}
                aria-label={`Keep ${item.title}`}
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Keep
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
