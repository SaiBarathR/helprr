'use client';

import { useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
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
import { Button } from '@/components/ui/button';
import type { CatalogFiltersResponse, CatalogItemsResponse } from '@/types/jellyfin-streaming';

const PAGE_SIZE = 50;

function defaultInclude(collectionType: string, view: string): string | undefined {
  const type = collectionType.toLowerCase();
  if (type === 'movies') return view === 'collections' ? 'BoxSet' : 'Movie';
  if (type === 'tvshows') return view === 'episodes' ? 'Episode' : 'Series';
  if (type === 'music') {
    if (view === 'artists') return 'MusicArtist';
    if (view === 'songs') return 'Audio';
    if (view === 'playlists') return 'Playlist';
    return 'MusicAlbum';
  }
  if (type === 'homevideos') return 'Video';
  if (type === 'books') return 'Book';
  if (type === 'boxsets') return 'BoxSet';
  if (type === 'playlists') return 'Playlist';
  return undefined;
}

function viewsFor(collectionType: string): Array<{ id: string; label: string }> {
  const type = collectionType.toLowerCase();
  if (type === 'movies') return [{ id: 'movies', label: 'Movies' }, { id: 'collections', label: 'Collections' }];
  if (type === 'tvshows') return [{ id: 'shows', label: 'Shows' }, { id: 'episodes', label: 'Episodes' }];
  if (type === 'music') {
    return [
      { id: 'albums', label: 'Albums' },
      { id: 'artists', label: 'Artists' },
      { id: 'songs', label: 'Songs' },
      { id: 'playlists', label: 'Playlists' },
    ];
  }
  return [];
}

export default function LibraryBrowserPage() {
  const params = useParams<{ libraryId: string }>();
  const searchParams = useSearchParams();
  const playback = useJellyfinPlayback();
  const name = searchParams.get('name') || 'Library';
  const collectionType = searchParams.get('type') || '';
  const availableViews = viewsFor(collectionType);
  const [view, setView] = useState(availableViews[0]?.id ?? '');
  const [sortBy, setSortBy] = useState('SortName');
  const [sortOrder, setSortOrder] = useState<'Ascending' | 'Descending'>('Ascending');
  const [filter, setFilter] = useState('');
  const [genre, setGenre] = useState('');
  const [year, setYear] = useState('');
  const [rating, setRating] = useState('');
  const [tag, setTag] = useState('');
  const includeItemTypes = defaultInclude(collectionType, view);
  const queryString = (() => {
    const next = new URLSearchParams({
      parentId: params.libraryId,
      recursive: 'true',
      sortBy,
      sortOrder,
      limit: String(PAGE_SIZE),
    });
    if (includeItemTypes) next.set('includeItemTypes', includeItemTypes);
    if (filter) next.set('filters', filter);
    if (genre) next.set('genres', genre);
    if (year) next.set('years', year);
    if (rating) next.set('officialRatings', rating);
    if (tag) next.set('tags', tag);
    if (view === 'artists') next.set('artistType', 'AlbumArtist');
    return next.toString();
  })();

  const filtersQuery = useQuery({
    queryKey: queryKeys.jellyfinFilters(params.libraryId),
    queryFn: jsonFetcher<CatalogFiltersResponse>(`/api/jellyfin/catalog/filters?parentId=${encodeURIComponent(params.libraryId)}`),
  });

  const query = useInfiniteQuery({
    queryKey: ['jellyfin', 'catalog', 'library', params.libraryId, view, sortBy, sortOrder, includeItemTypes, filter, genre, year, rating, tag],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      jsonFetcher<CatalogItemsResponse>(`/api/jellyfin/catalog/items?${queryString}&startIndex=${pageParam}`)({ signal }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });
  useRefreshAction(query.refetch);

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  if (query.isPending && items.length === 0) return <PageSpinner />;
  if (query.isError) {
    return <ErrorState message="Couldn't load this library." onRetry={() => void query.refetch()} />;
  }

  return (
    <>
      <PullToRefresh onRefresh={query.refetch} />
      <div className="space-y-4 p-4 pb-28">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
            <p className="text-xs text-muted-foreground">{query.data?.pages[0]?.total ?? items.length} titles</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void playback.playItems(items)}>Play all</Button>
            <Button size="sm" variant="outline" onClick={() => void playback.playItems(items, 0, { shuffle: true })}>Shuffle</Button>
            <WatchSubNav />
          </div>
        </div>
        {availableViews.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {availableViews.map((option) => (
              <Button key={option.id} size="sm" variant={view === option.id ? 'default' : 'outline'} onClick={() => setView(option.id)}>
                {option.label}
              </Button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {['SortName', 'PremiereDate', 'CommunityRating', 'DateCreated', 'DatePlayed', 'Runtime', 'Random'].map((field) => (
            <Button key={field} size="sm" variant={sortBy === field ? 'default' : 'outline'} onClick={() => setSortBy(field)}>
              {field === 'SortName' ? 'Name' : field === 'PremiereDate' ? 'Premiere' : field === 'CommunityRating' ? 'Rating' : field === 'DateCreated' ? 'Added' : field === 'DatePlayed' ? 'Played' : field === 'Runtime' ? 'Runtime' : 'Shuffle'}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={() => setSortOrder(sortOrder === 'Ascending' ? 'Descending' : 'Ascending')}>
            {sortOrder === 'Ascending' ? 'A–Z' : 'Z–A'}
          </Button>
          {['', 'IsUnplayed', 'IsPlayed', 'IsFavorite'].map((value) => (
            <Button key={value || 'all'} size="sm" variant={filter === value ? 'default' : 'outline'} onClick={() => setFilter(value)}>
              {value === '' ? 'All' : value === 'IsUnplayed' ? 'Unplayed' : value === 'IsPlayed' ? 'Played' : 'Favorites'}
            </Button>
          ))}
        </div>
        {(filtersQuery.data?.genres.length ?? 0) > 0 && (
          <FilterRow
            label="Genres"
            value={genre}
            onChange={setGenre}
            options={(filtersQuery.data?.genres ?? []).slice(0, 40).map((name) => ({ id: name, label: name }))}
          />
        )}
        {(filtersQuery.data?.years.length ?? 0) > 0 && (
          <FilterRow
            label="Years"
            value={year}
            onChange={setYear}
            options={(filtersQuery.data?.years ?? []).slice(0, 24).map((value) => ({ id: String(value), label: String(value) }))}
          />
        )}
        {(filtersQuery.data?.officialRatings.length ?? 0) > 0 && (
          <FilterRow
            label="Ratings"
            value={rating}
            onChange={setRating}
            options={(filtersQuery.data?.officialRatings ?? []).slice(0, 16).map((name) => ({ id: name, label: name }))}
          />
        )}
        {(filtersQuery.data?.tags.length ?? 0) > 0 && (
          <FilterRow
            label="Tags"
            value={tag}
            onChange={setTag}
            options={(filtersQuery.data?.tags ?? []).slice(0, 16).map((name) => ({ id: name, label: name }))}
          />
        )}
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

function FilterRow({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ id: string; label: string }>;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
      <Button size="sm" variant={value === '' ? 'default' : 'outline'} onClick={() => onChange('')}>All {label.toLowerCase()}</Button>
      {options.map((option) => (
        <Button key={option.id} size="sm" variant={value === option.id ? 'default' : 'outline'} onClick={() => onChange(option.id)}>
          {option.label}
        </Button>
      ))}
    </div>
  );
}
