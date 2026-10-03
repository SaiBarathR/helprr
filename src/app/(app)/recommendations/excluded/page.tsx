'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from '@/components/ui/app-link';
import { Ban, Film, Loader2, Sparkles, Tv } from 'lucide-react';
import { toast } from 'sonner';
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { ExcludedListSkeleton } from '@/components/recommendations/excluded-list-skeleton';
import { useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { jsonFetcher } from '@/lib/query-fetch';
import { formatDistanceToNowSafe } from '@/lib/format';
import { isProtectedApiImageSrc, toCachedImageSrc, type ImageServiceHint } from '@/lib/image';
import type { ExcludedPage, ExcludedTitle } from '@/lib/recommendations/excluded';

const EXCLUDED_QUERY_KEY = ['recommendations-excluded'] as const;

const MEDIA_LABEL = { movie: 'Movie', tv: 'Series', anime: 'Anime' } as const;
const REASON_LABEL = { not_interested: 'Not interested', dislike: 'Disliked' } as const;

function imageHintOf(itemKey: string): ImageServiceHint | undefined {
  if (itemKey.startsWith('tmdb:')) return 'tmdb';
  if (itemKey.startsWith('anilist:')) return 'anilist';
  if (itemKey.startsWith('arr:radarr:')) return 'radarr';
  if (itemKey.startsWith('arr:sonarr:')) return 'sonarr';
  return undefined;
}

function ExcludedRow({ item, restoring, onRestore }: { item: ExcludedTitle; restoring: boolean; onRestore: () => void }) {
  const poster = item.posterUrl ? toCachedImageSrc(item.posterUrl, imageHintOf(item.itemKey), { width: 160 }) ?? item.posterUrl : null;
  const FallbackIcon = item.mediaType === 'movie' ? Film : item.mediaType === 'anime' ? Sparkles : Tv;
  const kind = [item.mediaType ? MEDIA_LABEL[item.mediaType] : null, item.year].filter(Boolean).join(' · ');
  const when = `${REASON_LABEL[item.reason]} ${formatDistanceToNowSafe(item.excludedAt, '')}`.trim();

  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="relative aspect-[2/3] w-10 shrink-0 overflow-hidden rounded-md bg-muted">
        {poster ? (
          <Image src={poster} alt="" fill sizes="40px" className="object-cover" unoptimized={isProtectedApiImageSrc(poster)} />
        ) : (
          <FallbackIcon className="absolute inset-0 m-auto h-4 w-4 text-muted-foreground" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1">
        {item.title && item.href ? (
          <Link href={item.href} className="block truncate text-sm font-medium hover:underline">
            {item.title}
          </Link>
        ) : (
          <p className="truncate text-sm font-medium text-muted-foreground">{item.title ?? 'Unknown title'}</p>
        )}
        {kind && <p className="truncate text-xs text-muted-foreground">{kind}</p>}
        <p className="truncate text-xs text-muted-foreground">{when}</p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0"
        disabled={restoring}
        onClick={onRestore}
        aria-label={`Show ${item.title ?? 'this title'} again`}
      >
        {restoring && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Show again
      </Button>
    </div>
  );
}

export default function ExcludedTitlesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [restoring, setRestoring] = useState<ReadonlySet<string>>(new Set());
  // Titles shown again during this visit. Filtering them out at render (not
  // by editing the cache) means a "Show more" response that started before
  // the restore can't bring a row back.
  const [restored, setRestored] = useState<ReadonlySet<string>>(new Set());

  const query = useInfiniteQuery({
    queryKey: EXCLUDED_QUERY_KEY,
    queryFn: ({ pageParam, signal }) =>
      jsonFetcher<ExcludedPage>(
        pageParam ? `/api/recommendations/excluded?cursor=${encodeURIComponent(pageParam)}` : '/api/recommendations/excluded',
      )({ signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const restore = async (item: ExcludedTitle) => {
    setRestoring((prev) => new Set(prev).add(item.itemKey));
    try {
      const res = await fetch('/api/recommendations/excluded', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemKey: item.itemKey }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRestored((prev) => new Set(prev).add(item.itemKey));
      // Also drop it from the cache, so a later visit doesn't flash it first.
      queryClient.setQueryData<InfiniteData<ExcludedPage, string | null>>(EXCLUDED_QUERY_KEY, (prev) => prev && {
        ...prev,
        pages: prev.pages.map((page) => ({
          ...page,
          total: Math.max(0, page.total - 1),
          items: page.items.filter((other) => other.itemKey !== item.itemKey),
        })),
      });
      void queryClient.invalidateQueries({ queryKey: ['recommendations'] });
      void queryClient.invalidateQueries({ queryKey: ['recommendations-feed'] });
      void queryClient.invalidateQueries({ queryKey: ['recommendations-excluded-count'] });
      toast.success(`${item.title ?? 'The title'} can show up in recommendations again`);
    } catch {
      toast.error("Couldn't restore that title. Try again.");
    } finally {
      setRestoring((prev) => {
        const next = new Set(prev);
        next.delete(item.itemKey);
        return next;
      });
    }
  };

  const items = (query.data?.pages.flatMap((page) => page.items) ?? []).filter((item) => !restored.has(item.itemKey));

  return (
    <div className="space-y-3 animate-content-in">
      <PageHeader title="Excluded titles" subtitle="Recommendations" onBack={() => router.push('/recommendations')} />

      <div className="mx-auto max-w-2xl space-y-3">
        {query.isLoading ? (
          <ExcludedListSkeleton />
        ) : query.isError && !query.data ? (
          <ErrorState message="Couldn't load excluded titles." onRetry={() => void query.refetch()} retrying={query.isFetching} />
        ) : items.length === 0 && !query.hasNextPage ? (
          <div className="rounded-xl bg-card p-8 text-center text-muted-foreground">
            <Ban className="mx-auto mb-2 h-8 w-8 opacity-40" />
            <p>Nothing excluded.</p>
            <p className="mt-1 text-sm">Titles you mark Not interested or dislike are listed here.</p>
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              These never show up in recommendations. Show one again to let it back in.
            </p>
            {items.length > 0 && (
              <div className="divide-y rounded-xl bg-card">
                {items.map((item) => (
                  <ExcludedRow
                    key={item.itemKey}
                    item={item}
                    restoring={restoring.has(item.itemKey)}
                    onRestore={() => void restore(item)}
                  />
                ))}
              </div>
            )}
            {query.isFetchNextPageError && (
              <p className="text-center text-xs text-muted-foreground">Couldn&apos;t load more. Try again.</p>
            )}
            {query.hasNextPage && (
              <div className="flex justify-center">
                <Button variant="outline" size="sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                  {query.isFetchingNextPage && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Show more
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
