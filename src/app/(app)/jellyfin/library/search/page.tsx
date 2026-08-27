'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { Input } from '@/components/ui/input';
import { WatchSubNav } from '@/components/jellyfin-streaming/watch-subnav';
import { CatalogPosterCard } from '@/components/jellyfin-streaming/poster-card';
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
    <div className="space-y-4 p-4 pb-28 md:p-6">
      <h1 className="sr-only">Search</h1>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <WatchSubNav />
      </div>

      <Input
        value={q}
        onChange={(event) => setQ(event.target.value)}
        placeholder="Search movies, shows, people, music…"
        aria-label="Search Jellyfin"
        autoFocus
      />

      {query.isError && <ErrorState compact message="Search failed." onRetry={() => void query.refetch()} />}

      {!debounced && (suggestions.data?.items.length ?? 0) > 0 && (
        <section className="space-y-2">
          <h2 className="text-center text-base font-semibold">Suggestions</h2>
          <ul className="space-y-1 text-center">
            {(suggestions.data?.items ?? []).map((item) => (
              <li key={item.Id}>
                <Link
                  href={`/jellyfin/library/item/${item.Id}`}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {item.Name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {debounced && !query.isFetching && groups.length === 0 && (
        <p className="text-sm text-muted-foreground">No results for &ldquo;{debounced}&rdquo;.</p>
      )}

      {groups.map((group) => (
        <section key={group.type} className="space-y-2">
          <h2 className="text-base font-semibold">{group.title}</h2>
          {/* A grid, not a rail: search results are a set to scan, not a row to browse. */}
          <div className="flex flex-wrap gap-3">
            {group.items.map((item, index) => (
              <CatalogPosterCard
                key={item.Id}
                item={item}
                shape={group.shape}
                priority={index < 6}
                onPlay={(next) => void playback.playItem(next)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
