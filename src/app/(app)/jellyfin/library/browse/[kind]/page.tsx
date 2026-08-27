'use client';

import Link from 'next/link';
import { notFound, useParams, useSearchParams } from 'next/navigation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { useRefreshAction } from '@/lib/hooks/use-refresh-action';
import { PageSpinner } from '@/components/ui/page-spinner';
import { ErrorState } from '@/components/ui/error-state';
import { WatchSubNav } from '@/components/jellyfin-streaming/watch-subnav';
import { CatalogPosterCard } from '@/components/jellyfin-streaming/poster-card';
import { useJellyfinPlayback } from '@/components/jellyfin-streaming/playback-provider';
import { jellyfinImageUrl } from '@/lib/jellyfin-playback/image';
import { FadeInImage } from '@/components/media/fade-in-image';
import { Button } from '@/components/ui/button';
import type { CatalogBrowseKind, CatalogBrowseResponse, CatalogItemsResponse } from '@/types/jellyfin-streaming';

const PAGE_SIZE = 50;

const KINDS: Record<CatalogBrowseKind, { title: string; empty: string; filterParam: 'genreIds' | 'studioIds' | null }> = {
  genres: { title: 'Genres', empty: 'No genres in your libraries yet.', filterParam: 'genreIds' },
  studios: { title: 'Studios', empty: 'No studios in your libraries yet.', filterParam: 'studioIds' },
  // People already have a detail page with filmography — link there instead of
  // duplicating the filtered grid.
  persons: { title: 'People', empty: 'No people in your libraries yet.', filterParam: null },
};

function isBrowseKind(value: string): value is CatalogBrowseKind {
  return Object.hasOwn(KINDS, value);
}

export default function BrowsePage() {
  const params = useParams<{ kind: string }>();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get('id');
  const selectedName = searchParams.get('name') ?? '';

  if (!isBrowseKind(params.kind)) notFound();
  const kind = params.kind;
  const config = KINDS[kind];

  return selectedId && config.filterParam
    ? <FilteredItems kind={kind} filterParam={config.filterParam} id={selectedId} name={selectedName} />
    : <EntityList kind={kind} />;
}

function EntityList({ kind }: { kind: CatalogBrowseKind }) {
  const config = KINDS[kind];
  const query = useQuery({
    queryKey: queryKeys.jellyfinBrowse(kind),
    queryFn: jsonFetcher<CatalogBrowseResponse>(`/api/jellyfin/catalog/browse?kind=${kind}&limit=200`),
  });
  useRefreshAction(query.refetch);

  if (query.isPending && !query.data) return <PageSpinner />;
  if (query.isError) return <ErrorState message={`Couldn't load ${config.title.toLowerCase()}.`} onRetry={() => void query.refetch()} />;

  const items = query.data?.items ?? [];

  return (
    <>
      <PullToRefresh onRefresh={query.refetch} />
      <div className="space-y-4 p-4 pb-28">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{config.title}</h1>
            <p className="text-xs text-muted-foreground">{items.length} in your libraries</p>
          </div>
          <WatchSubNav />
        </div>

        <BrowseKindTabs active={kind} />

        {items.length === 0 && <p className="text-sm text-muted-foreground">{config.empty}</p>}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => {
            const image = jellyfinImageUrl(item.Id, 'Primary', 240);
            const href = config.filterParam
              ? `/jellyfin/library/browse/${kind}?id=${encodeURIComponent(item.Id)}&name=${encodeURIComponent(item.Name)}`
              : `/jellyfin/library/item/${item.Id}`;
            return (
              <Link
                key={item.Id}
                href={href}
                className="flex items-center gap-3 rounded-lg border bg-card p-2 hover:bg-accent"
              >
                <div className="relative size-12 shrink-0 overflow-hidden rounded bg-muted">
                  {image && <FadeInImage src={image} alt="" fill sizes="48px" unoptimized className="object-cover" />}
                </div>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.Name}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}

function BrowseKindTabs({ active }: { active: CatalogBrowseKind }) {
  return (
    <div className="flex gap-1">
      {(Object.keys(KINDS) as CatalogBrowseKind[]).map((kind) => (
        <Link
          key={kind}
          href={`/jellyfin/library/browse/${kind}`}
          aria-current={kind === active ? 'page' : undefined}
          className={
            kind === active
              ? 'rounded-md bg-[var(--hpr-amber)] px-2.5 py-1 text-sm font-medium text-[var(--hpr-ink)]'
              : 'rounded-md px-2.5 py-1 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground'
          }
        >
          {KINDS[kind].title}
        </Link>
      ))}
    </div>
  );
}

function FilteredItems({
  kind,
  filterParam,
  id,
  name,
}: {
  kind: CatalogBrowseKind;
  filterParam: 'genreIds' | 'studioIds';
  id: string;
  name: string;
}) {
  const playback = useJellyfinPlayback();
  const queryString = new URLSearchParams({
    [filterParam]: id,
    recursive: 'true',
    sortBy: 'SortName',
    limit: String(PAGE_SIZE),
    includeItemTypes: 'Movie,Series',
  }).toString();

  const query = useInfiniteQuery({
    queryKey: queryKeys.jellyfinItems({ browse: kind, id }),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => jsonFetcher<CatalogItemsResponse>(
      `/api/jellyfin/catalog/items?${queryString}&startIndex=${pageParam}`,
    )(),
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.items.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
  });
  useRefreshAction(query.refetch);

  if (query.isPending && !query.data) return <PageSpinner />;
  if (query.isError) return <ErrorState message="Couldn't load titles." onRetry={() => void query.refetch()} />;

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <PullToRefresh onRefresh={query.refetch} />
      <div className="space-y-4 p-4 pb-28">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{name || KINDS[kind].title}</h1>
            <Link href={`/jellyfin/library/browse/${kind}`} className="text-xs text-muted-foreground hover:underline">
              ← All {KINDS[kind].title.toLowerCase()}
            </Link>
          </div>
          <WatchSubNav />
        </div>

        {items.length === 0 && <p className="text-sm text-muted-foreground">Nothing here yet.</p>}

        <div className="flex flex-wrap gap-3">
          {items.map((item) => (
            <CatalogPosterCard key={item.Id} item={item} onPlay={(next) => void playback.playItem(next)} />
          ))}
        </div>

        {query.hasNextPage && (
          <div className="flex justify-center">
            <Button variant="outline" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
              {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
