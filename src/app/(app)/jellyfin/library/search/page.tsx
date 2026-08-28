'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { Search as SearchIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { WatchTopBar } from '@/components/jellyfin-streaming/watch-top-bar';
import { CatalogPosterCard } from '@/components/jellyfin-streaming/poster-card';
import { SearchResultRow } from '@/components/jellyfin-streaming/cinematic/search-result-row';
import { useWatchSkin } from '@/lib/hooks/use-watch-skin';
import { useCompactViewport } from '@/lib/hooks/use-compact-viewport';
import { cn } from '@/lib/utils';
import { useJellyfinPlayback } from '@/components/jellyfin-streaming/playback-provider';
import { ErrorState } from '@/components/ui/error-state';
import type { CatalogCardShape } from '@/lib/jellyfin-playback/image';
import type { CatalogItemsResponse } from '@/types/jellyfin-streaming';
import type { JellyfinItem } from '@/types/jellyfin';

const GROUPS: Array<{ type: string; title: string; shape: CatalogCardShape }> = [
  { type: 'Movie', title: 'Movies', shape: 'portrait' },
  { type: 'Series', title: 'Shows', shape: 'portrait' },
  { type: 'Episode', title: 'Episodes', shape: 'landscape' },
  { type: 'Person', title: 'People', shape: 'portrait' },
  { type: 'MusicAlbum', title: 'Albums', shape: 'square' },
  { type: 'MusicArtist', title: 'Artists', shape: 'portrait' },
  { type: 'Audio', title: 'Songs', shape: 'square' },
  { type: 'Playlist', title: 'Playlists', shape: 'portrait' },
  { type: 'BoxSet', title: 'Collections', shape: 'portrait' },
  { type: 'Book', title: 'Books', shape: 'portrait' },
  { type: 'LiveTvChannel', title: 'Live TV', shape: 'landscape' },
  { type: 'Video', title: 'Videos', shape: 'landscape' },
];

function groupItems(items: JellyfinItem[]) {
  const claimed = new Set<string>();
  const groups = GROUPS.map((group) => {
    const matched = items.filter((item) => item.Type === group.type);
    matched.forEach((item) => claimed.add(item.Id));
    return { ...group, items: matched };
  }).filter((group) => group.items.length > 0);

  const rest = items.filter((item) => !claimed.has(item.Id));
  if (rest.length > 0) {
    groups.push({ type: 'Other', title: 'Other', shape: 'portrait', items: rest });
  }
  return groups;
}

export default function JellyfinSearchPage() {
  const playback = useJellyfinPlayback();
  const cinematic = useWatchSkin() === 'cinematic';
  const compact = useCompactViewport();
  // The app lists search hits in a column on a phone and shows 16:9 title
  // cards on a wide screen; a portrait poster grid is neither.
  const asList = cinematic && compact;
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(q.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [q]);

  const query = useQuery({
    queryKey: queryKeys.jellyfinSearch(debounced),
    queryFn: jsonFetcher<CatalogItemsResponse>(`/api/jellyfin/catalog/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length > 0,
  });

  // The reference never shows a blank search page; it offers titles to open.
  const suggestions = useQuery({
    queryKey: ['jellyfin', 'catalog', 'search-suggestions'],
    queryFn: jsonFetcher<CatalogItemsResponse>(
      '/api/jellyfin/catalog/items?recursive=true&includeItemTypes=Movie,Series&sortBy=Random&limit=18',
    ),
    staleTime: 5 * 60_000,
  });

  const groups = useMemo(() => groupItems(query.data?.items ?? []), [query.data?.items]);

  return (
    <div className="space-y-4 py-4 pb-28 md:py-6">
      <h1 className="sr-only">Search</h1>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <WatchTopBar />
      </div>

      {cinematic ? (
        // The field *is* the header on the site's search screen: a full-bleed
        // grey bar at the top, no page title above it.
        <div className="relative -mx-[var(--main-pad-x)]">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-[var(--main-pad-x)] size-5 -translate-y-1/2 text-white/60" />
          <Input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search shows, movies, people…"
            aria-label="Search Jellyfin"
            autoFocus
            className="h-14 rounded-none border-0 bg-[#2a2a2a] pl-[calc(var(--main-pad-x)+2rem)] text-base text-white placeholder:text-white/60 focus-visible:ring-0"
          />
        </div>
      ) : (
        <Input
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder="Search movies, shows, people, music…"
          aria-label="Search Jellyfin"
          autoFocus
        />
      )}

      {query.isError && <ErrorState compact message="Search failed." onRetry={() => void query.refetch()} />}

      {!debounced && (suggestions.data?.items.length ?? 0) > 0 && (
        <section className="space-y-2">
          <h2 className={cn('font-semibold', cinematic ? 'text-lg' : 'text-base')}>
            {cinematic ? 'Recommended Shows & Movies' : 'Suggestions'}
          </h2>
          {/* Artwork, not a centred list of links. An empty search on the site
              is still a wall of titles you can open — a column of text names
              gives you nothing to recognise a film by. */}
          {asList ? (
            <ul className="space-y-3">
              {(suggestions.data?.items ?? []).map((item) => (
                <SearchResultRow key={item.Id} item={item} onPlay={(next) => void playback.playItem(next)} />
              ))}
            </ul>
          ) : (
            <div className={cn(
              cinematic
                // A sized grid, so a flat card can fill its column: without a
                // column width the card has nothing to measure against.
                ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
                : 'flex flex-wrap gap-3',
            )}>
              {(suggestions.data?.items ?? []).map((item, index) => (
                <CatalogPosterCard
                  key={item.Id}
                  item={item}
                  shape={cinematic ? 'landscape' : 'portrait'}
                  // A wrapped grid, not a rail: the hover popover would grow
                  // over its neighbours and clip at the page edge.
                  flat={cinematic}
                  className={cinematic ? 'w-full' : undefined}
                  priority={index < 6}
                  onPlay={(next) => void playback.playItem(next)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {debounced && !query.isFetching && groups.length === 0 && (
        <p className="text-sm text-muted-foreground">No results for &ldquo;{debounced}&rdquo;.</p>
      )}

      {groups.map((group) => (
        <section key={group.type} className="space-y-2">
          <h2 className={cn('font-semibold', cinematic ? 'text-lg' : 'text-base')}>{group.title}</h2>
          {asList ? (
            <ul className="space-y-3">
              {group.items.map((item) => (
                <SearchResultRow key={item.Id} item={item} onPlay={(next) => void playback.playItem(next)} />
              ))}
            </ul>
          ) : (
            // A grid, not a rail: search results are a set to scan, not a row to browse.
            <div className={cn(
              cinematic
                ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
                : 'flex flex-wrap gap-3',
            )}>
              {group.items.map((item, index) => (
                <CatalogPosterCard
                  key={item.Id}
                  item={item}
                  shape={cinematic && group.shape === 'portrait' ? 'landscape' : group.shape}
                  flat={cinematic}
                  className={cinematic ? 'w-full' : undefined}
                  priority={index < 6}
                  onPlay={(next) => void playback.playItem(next)}
                />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
