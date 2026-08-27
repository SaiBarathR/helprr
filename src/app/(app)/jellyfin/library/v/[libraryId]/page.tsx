'use client';

import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownAZ, ChevronLeft, ChevronRight, Play, Shuffle, SlidersHorizontal } from 'lucide-react';
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
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import type { CatalogCardShape } from '@/lib/jellyfin-playback/image';
import type { CatalogFiltersResponse, CatalogItemsResponse } from '@/types/jellyfin-streaming';

/** The reference install runs a 100-item library page; matching it keeps the
 *  "1-100 of 492" range honest and the grid a sane size. */
const PAGE_SIZE = 100;
const PLAY_ALL_MAX = 500;
const PLAY_ALL_PAGE = 200;

const SORT_FIELDS: Array<{ id: string; label: string }> = [
  { id: 'SortName', label: 'Name' },
  { id: 'PremiereDate', label: 'Premiere' },
  { id: 'CommunityRating', label: 'Rating' },
  { id: 'DateCreated', label: 'Added' },
  { id: 'DatePlayed', label: 'Played' },
  { id: 'Runtime', label: 'Runtime' },
  { id: 'Random', label: 'Random' },
];

const WATCH_FILTERS: Array<{ id: string; label: string }> = [
  { id: '', label: 'All' },
  { id: 'IsUnplayed', label: 'Unplayed' },
  { id: 'IsPlayed', label: 'Played' },
  { id: 'IsFavorite', label: 'Favorites' },
];

const ALPHABET = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];

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

function shapeFor(collectionType: string, view: string): CatalogCardShape {
  const type = collectionType.toLowerCase();
  if (type === 'music') return view === 'artists' ? 'portrait' : 'square';
  if (view === 'episodes') return 'landscape';
  return 'portrait';
}

/** Individual years are unusable in a filter list; decades are not. */
function decadesFrom(years: number[]): number[] {
  return [...new Set(years.map((year) => Math.floor(year / 10) * 10))].sort((a, b) => b - a);
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
  const [decade, setDecade] = useState('');
  const [rating, setRating] = useState('');
  const [tag, setTag] = useState('');
  const [letter, setLetter] = useState('');
  const [page, setPage] = useState(0);
  const [queueing, setQueueing] = useState(false);

  const includeItemTypes = defaultInclude(collectionType, view);
  const shape = shapeFor(collectionType, view);

  const buildQuery = (limit: number, startIndex: number): string => {
    const next = new URLSearchParams({
      parentId: params.libraryId,
      recursive: 'true',
      sortBy,
      sortOrder,
      limit: String(limit),
      startIndex: String(startIndex),
    });
    if (includeItemTypes) next.set('includeItemTypes', includeItemTypes);
    if (filter) next.set('filters', filter);
    if (genre) next.set('genres', genre);
    if (decade) {
      // Jellyfin takes a comma-separated year list, so expand the bucket.
      const start = Number(decade);
      next.set('years', Array.from({ length: 10 }, (_, offset) => start + offset).join(','));
    }
    if (rating) next.set('officialRatings', rating);
    if (tag) next.set('tags', tag);
    if (letter) next.set('nameStartsWith', letter === '#' ? '0' : letter);
    if (view === 'artists') next.set('artistType', 'AlbumArtist');
    return next.toString();
  };

  const filtersQuery = useQuery({
    queryKey: queryKeys.jellyfinFilters(params.libraryId),
    queryFn: jsonFetcher<CatalogFiltersResponse>(`/api/jellyfin/catalog/filters?parentId=${encodeURIComponent(params.libraryId)}`),
  });

  const query = useQuery({
    queryKey: ['jellyfin', 'catalog', 'library', params.libraryId, view, sortBy, sortOrder, includeItemTypes, filter, genre, decade, rating, tag, letter, page],
    queryFn: ({ signal }) =>
      jsonFetcher<CatalogItemsResponse>(`/api/jellyfin/catalog/items?${buildQuery(PAGE_SIZE, page * PAGE_SIZE)}`)({ signal }),
  });
  useRefreshAction(query.refetch);

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const decades = useMemo(() => decadesFrom(filtersQuery.data?.years ?? []), [filtersQuery.data?.years]);
  const activeFilters = [filter, genre, decade, rating, tag, letter].filter(Boolean).length;

  // Reset to the first page whenever the result set changes shape.
  const resetAndSet = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); setPage(0); };

  const playEverything = async (shuffle: boolean) => {
    setQueueing(true);
    try {
      const collected: typeof items = [];
      let startIndex = 0;
      let count = Number.POSITIVE_INFINITY;
      while (collected.length < Math.min(count, PLAY_ALL_MAX)) {
        const chunk = await jsonFetcher<CatalogItemsResponse>(
          `/api/jellyfin/catalog/items?${buildQuery(PLAY_ALL_PAGE, startIndex)}`,
        )();
        count = chunk.total;
        if (chunk.items.length === 0) break;
        collected.push(...chunk.items);
        startIndex += chunk.items.length;
      }
      if (collected.length > 0) await playback.playItems(collected, 0, shuffle ? { shuffle: true } : undefined);
    } finally {
      setQueueing(false);
    }
  };

  if (query.isPending && items.length === 0) return <PageSpinner />;
  if (query.isError) {
    return <ErrorState message="Couldn't load this library." onRetry={() => void query.refetch()} />;
  }

  const first = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const last = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <>
      <PullToRefresh onRefresh={query.refetch} />
      <div className="space-y-4 p-4 pb-28 md:p-6">
        <h1 className="sr-only">{name}</h1>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-base font-semibold tracking-tight">{name}</p>
          <WatchSubNav />
        </div>

        {availableViews.length > 1 && (
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-border p-0.5 app-chrome-bar bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            {availableViews.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => { setView(option.id); setPage(0); }}
                aria-current={view === option.id ? 'page' : undefined}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  view === option.id
                    ? 'bg-[var(--hpr-amber)] text-[var(--hpr-ink)] shadow-sm'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        {/* One toolbar instead of five stacked pill rows. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {total === 0 ? 'No titles' : `${first}–${last} of ${total}`}
          </span>
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="Previous page"
            disabled={page === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          >
            <ChevronLeft />
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="Next page"
            disabled={last >= total}
            onClick={() => setPage((current) => current + 1)}
          >
            <ChevronRight />
          </Button>

          <span className="ml-auto flex items-center gap-2">
            <Button size="icon-sm" variant="outline" aria-label="Play all" title="Play all" disabled={queueing} onClick={() => void playEverything(false)}>
              <Play className="fill-current" />
            </Button>
            <Button size="icon-sm" variant="outline" aria-label="Shuffle all" title="Shuffle all" disabled={queueing} onClick={() => void playEverything(true)}>
              <Shuffle />
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              aria-label={`Sort ${sortOrder === 'Ascending' ? 'descending' : 'ascending'}`}
              title={sortOrder === 'Ascending' ? 'A–Z' : 'Z–A'}
              onClick={() => { setSortOrder(sortOrder === 'Ascending' ? 'Descending' : 'Ascending'); setPage(0); }}
            >
              <ArrowDownAZ className={sortOrder === 'Descending' ? 'rotate-180' : undefined} />
            </Button>

            <Sheet>
              <SheetTrigger asChild>
                <Button size="sm" variant={activeFilters > 0 ? 'default' : 'outline'}>
                  <SlidersHorizontal data-icon="inline-start" />
                  {activeFilters > 0 ? `Filters · ${activeFilters}` : 'Filters'}
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-sm">
                <SheetHeader>
                  <SheetTitle>Sort &amp; filter</SheetTitle>
                </SheetHeader>
                <div className="space-y-5 p-4">
                  <PillGroup
                    label="Sort by"
                    value={sortBy}
                    options={SORT_FIELDS}
                    onChange={resetAndSet(setSortBy)}
                  />
                  <PillGroup
                    label="Status"
                    value={filter}
                    options={WATCH_FILTERS}
                    onChange={resetAndSet(setFilter)}
                  />
                  {(filtersQuery.data?.genres.length ?? 0) > 0 && (
                    <PillGroup
                      label="Genre"
                      value={genre}
                      options={[{ id: '', label: 'Any' }, ...(filtersQuery.data?.genres ?? []).map((g) => ({ id: g, label: g }))]}
                      onChange={resetAndSet(setGenre)}
                    />
                  )}
                  {decades.length > 0 && (
                    <PillGroup
                      label="Decade"
                      value={decade}
                      options={[{ id: '', label: 'Any' }, ...decades.map((d) => ({ id: String(d), label: `${d}s` }))]}
                      onChange={resetAndSet(setDecade)}
                    />
                  )}
                  {(filtersQuery.data?.officialRatings.length ?? 0) > 0 && (
                    <PillGroup
                      label="Rating"
                      value={rating}
                      options={[{ id: '', label: 'Any' }, ...(filtersQuery.data?.officialRatings ?? []).map((r) => ({ id: r, label: r }))]}
                      onChange={resetAndSet(setRating)}
                    />
                  )}
                  {(filtersQuery.data?.tags.length ?? 0) > 0 && (
                    <PillGroup
                      label="Tag"
                      value={tag}
                      options={[{ id: '', label: 'Any' }, ...(filtersQuery.data?.tags ?? []).slice(0, 40).map((t) => ({ id: t, label: t }))]}
                      onChange={resetAndSet(setTag)}
                    />
                  )}
                  {activeFilters > 0 && (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        setFilter(''); setGenre(''); setDecade(''); setRating(''); setTag(''); setLetter(''); setPage(0);
                      }}
                    >
                      Clear all filters
                    </Button>
                  )}
                </div>
              </SheetContent>
            </Sheet>
          </span>
        </div>

        <div className="flex gap-3">
          <div className="min-w-0 flex-1">
            {items.length === 0 && <p className="text-sm text-muted-foreground">Nothing matches these filters.</p>}
            <div className="flex flex-wrap gap-3">
              {items.map((item, index) => (
                <CatalogPosterCard
                  key={item.Id}
                  item={item}
                  shape={shape}
                  priority={index < 6}
                  onPlay={(next) => void playback.playItem(next)}
                />
              ))}
            </div>
          </div>

          {/* A–Z jump rail, as the reference has on library grids. */}
          <nav aria-label="Jump to letter" className="hidden shrink-0 flex-col items-center gap-px text-[10px] leading-none md:flex">
            {ALPHABET.map((entry) => (
              <button
                key={entry}
                type="button"
                aria-pressed={letter === entry}
                onClick={() => { setLetter(letter === entry ? '' : entry); setPage(0); }}
                className={cn(
                  'w-4 rounded px-1 py-0.5 transition-colors',
                  letter === entry ? 'bg-[var(--hpr-amber)] text-[var(--hpr-ink)]' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {entry}
              </button>
            ))}
          </nav>
        </div>
      </div>
    </>
  );
}

function PillGroup({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ id: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option.id || 'any'}
            type="button"
            onClick={() => onChange(option.id)}
            aria-pressed={value === option.id}
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs transition-colors',
              value === option.id
                ? 'border-[var(--hpr-amber)] bg-[var(--hpr-amber)] text-[var(--hpr-ink)]'
                : 'border-border text-muted-foreground hover:border-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
