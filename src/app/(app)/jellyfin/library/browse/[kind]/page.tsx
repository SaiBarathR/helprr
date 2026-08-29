'use client';

import Link from 'next/link';
import { notFound, useParams, useSearchParams } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { useRefreshAction } from '@/lib/hooks/use-refresh-action';
import { PageSpinner } from '@/components/ui/page-spinner';
import { ErrorState } from '@/components/ui/error-state';
import { WatchTopBar } from '@/components/jellyfin-streaming/watch-top-bar';
import { CatalogPosterCard } from '@/components/jellyfin-streaming/poster-card';
import { CATALOG_GRID_CLASS, CATALOG_WRAP_CLASS } from '@/components/jellyfin-streaming/card-shared';
import { useWatchSkin } from '@/lib/hooks/use-watch-skin';
import { useJellyfinPlayback } from '@/components/jellyfin-streaming/playback-provider';
import { jellyfinImageUrl } from '@/lib/jellyfin-playback/image';
import { FadeInImage } from '@/components/media/fade-in-image';
import { Button } from '@/components/ui/button';
import type {
  CatalogBrowseKind,
  CatalogBrowseResponse,
  CatalogItemsResponse,
  CatalogViewsResponse,
} from '@/types/jellyfin-streaming';

const PAGE_SIZE = 50;

const KINDS: Record<CatalogBrowseKind, { title: string; empty: string; filterParam: 'genreIds' | 'studioIds' | null }> = {
  genres: { title: 'Genres', empty: 'No genres in your libraries yet.', filterParam: 'genreIds' },
  studios: { title: 'Studios', empty: 'No studios in your libraries yet.', filterParam: 'studioIds' },
  // People already have a detail page with filmography — link there instead of
  // duplicating the filtered grid.
  persons: { title: 'People', empty: 'No people in your libraries yet.', filterParam: null },
};

/** Browse's first tab: the libraries themselves, which had no entry point. */
const LIBRARIES_TAB = { id: 'libraries', title: 'Libraries' } as const;

function isBrowseKind(value: string): value is CatalogBrowseKind {
  return Object.hasOwn(KINDS, value);
}

export default function BrowsePage() {
  const params = useParams<{ kind: string }>();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get('id');
  const selectedName = searchParams.get('name') ?? '';

  if (params.kind === LIBRARIES_TAB.id) return <LibraryList />;
  if (!isBrowseKind(params.kind)) notFound();
  const kind = params.kind;
  const config = KINDS[kind];

  return selectedId && config.filterParam
    ? <FilteredItems kind={kind} filterParam={config.filterParam} id={selectedId} name={selectedName} />
    : <EntityList kind={kind} />;
}

const ENTITY_PAGE_SIZE = 100;

function LibraryList() {
  const query = useQuery({
    queryKey: ['jellyfin', 'catalog', 'views'],
    queryFn: jsonFetcher<CatalogViewsResponse>('/api/jellyfin/catalog/views'),
  });
  useRefreshAction(query.refetch);

  if (query.isPending && !query.data) return <PageSpinner />;
  if (query.isError) return <ErrorState message="Couldn't load your libraries." onRetry={() => void query.refetch()} />;
  const views = query.data?.views ?? [];

  return (
    <div className="space-y-4 py-4 pb-28">
      <h1 className="sr-only">Libraries</h1>
      <WatchTopBar />
      <BrowseKindTabs active="libraries" />
      {views.length === 0 && <p className="text-sm text-muted-foreground">No libraries on this Jellyfin server.</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {views.map((view) => {
          const art = jellyfinImageUrl(view.Id, 'Primary', 480);
          return (
            <Link
              key={view.Id}
              href={`/jellyfin/library/v/${view.Id}?name=${encodeURIComponent(view.Name)}&type=${encodeURIComponent(view.CollectionType || '')}`}
              aria-label={view.Name}
              className="group relative aspect-video overflow-hidden rounded-xl border border-border/40 bg-muted/60"
            >
              {art && (
                <FadeInImage src={art} alt="" fill sizes="480px" unoptimized className="object-cover transition-transform duration-300 group-hover:scale-[1.04]" />
              )}
              <span className="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent" />
              {/* Jellyfin's generated library art already carries the name, so
                  the caption only appears when there is no art — without it a
                  server whose views carry no Primary image renders this whole
                  screen as a row of blank grey rectangles you cannot tell
                  apart. */}
              {!art && (
                <span className="absolute inset-0 flex items-center justify-center p-4 text-center text-lg font-medium">
                  {view.Name}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function EntityList({ kind }: { kind: CatalogBrowseKind }) {
  const config = KINDS[kind];
  const [search, setSearch] = useState('');
  const searchTerm = useDeferredValue(search.trim());

  // A large library can hold thousands of studios or people, so this pages
  // rather than capping — a truncated list would read as "that's all of them".
  const query = useInfiniteQuery({
    queryKey: queryKeys.jellyfinBrowse(kind, searchTerm),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => jsonFetcher<CatalogBrowseResponse>(
      `/api/jellyfin/catalog/browse?kind=${kind}&limit=${ENTITY_PAGE_SIZE}&startIndex=${pageParam}`
      + (searchTerm ? `&searchTerm=${encodeURIComponent(searchTerm)}` : ''),
    )(),
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.items.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
  });
  useRefreshAction(query.refetch);

  if (query.isPending && !query.data) return <PageSpinner />;
  if (query.isError) return <ErrorState message={`Couldn't load ${config.title.toLowerCase()}.`} onRetry={() => void query.refetch()} />;

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const total = query.data?.pages[0]?.total ?? items.length;

  return (
    <>
      <PullToRefresh onRefresh={query.refetch} />
      <div className="space-y-4 py-4 pb-28">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="sr-only">{config.title}</h1>
            <p className="text-xs text-muted-foreground">
              {searchTerm
                ? `${total} matching "${searchTerm}"`
                : `${items.length} of ${total} in your libraries`}
            </p>
          </div>
          <WatchTopBar />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <BrowseKindTabs active={kind} />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`Filter ${config.title.toLowerCase()}…`}
            aria-label={`Filter ${config.title.toLowerCase()}`}
            className="h-8 min-w-40 flex-1 rounded-md border bg-card px-2 text-sm"
          />
        </div>

        {items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {searchTerm ? `Nothing matching "${searchTerm}".` : config.empty}
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => {
            // Only ask for art the entity actually has, or the initial-letter
            // fallback never gets a chance. Studios carry a Thumb rather than a
            // Primary, which is why they all used to render as letters.
            const artType = (['Primary', 'Thumb', 'Logo'] as const)
              .find((type) => item.ImageTags?.[type]);
            const image = artType ? jellyfinImageUrl(item.Id, artType, 240) : null;
            const href = config.filterParam
              ? `/jellyfin/library/browse/${kind}?id=${encodeURIComponent(item.Id)}&name=${encodeURIComponent(item.Name)}`
              : `/jellyfin/library/item/${item.Id}`;
            return (
              <Link
                key={item.Id}
                href={href}
                className="flex items-center gap-3 rounded-lg border bg-card p-2 hover:bg-accent"
              >
                <div className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded bg-muted text-sm font-semibold text-muted-foreground">
                  {image
                    ? <FadeInImage src={image} alt="" fill sizes="48px" unoptimized className={artType === 'Primary' ? 'object-cover' : 'object-contain p-1'} />
                    : (item.Name?.[0] ?? '?').toUpperCase()}
                </div>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.Name}</span>
              </Link>
            );
          })}
        </div>

        {query.hasNextPage && (
          <div className="flex justify-center">
            <Button variant="outline" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
              {query.isFetchingNextPage ? 'Loading…' : `Load more (${items.length} of ${total})`}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

function BrowseKindTabs({ active }: { active: CatalogBrowseKind | 'libraries' }) {
  return (
    <div className="flex gap-1">
      <Link
        href={`/jellyfin/library/browse/${LIBRARIES_TAB.id}`}
        aria-current={active === LIBRARIES_TAB.id ? 'page' : undefined}
        className={
          active === LIBRARIES_TAB.id
            ? 'rounded-md bg-[var(--hpr-amber)] px-2.5 py-1 text-sm font-medium text-[var(--hpr-ink)]'
            : 'rounded-md px-2.5 py-1 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground'
        }
      >
        {LIBRARIES_TAB.title}
      </Link>
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
  const cinematic = useWatchSkin() === 'cinematic';
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
      <div className="space-y-4 py-4 pb-28">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="sr-only">{name || KINDS[kind].title}</h1>
            <p className="text-base font-semibold tracking-tight">{name || KINDS[kind].title}</p>
            <Link href={`/jellyfin/library/browse/${kind}`} className="text-xs text-muted-foreground hover:underline">
              ← All {KINDS[kind].title.toLowerCase()}
            </Link>
          </div>
          <WatchTopBar />
        </div>

        {items.length === 0 && <p className="text-sm text-muted-foreground">Nothing here yet.</p>}

        <div className={cinematic ? CATALOG_GRID_CLASS : CATALOG_WRAP_CLASS}>
          {items.map((item, index) => (
            <CatalogPosterCard
              key={item.Id}
              item={item}
              // A wrapped grid, not a rail: the hover popover would grow over
              // its neighbours and clip at the page edge.
              flat={cinematic}
              className={cinematic ? 'w-full' : undefined}
              priority={index < 6}
              onPlay={(next) => void playback.playItem(next)}
            />
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
