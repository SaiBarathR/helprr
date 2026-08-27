'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { Input } from '@/components/ui/input';
import { WatchSubNav } from '@/components/jellyfin-streaming/watch-subnav';
import { CatalogPosterCard } from '@/components/jellyfin-streaming/poster-card';
import { CatalogRail } from '@/components/jellyfin-streaming/catalog-rail';
import { useJellyfinPlayback } from '@/components/jellyfin-streaming/playback-provider';
import { ErrorState } from '@/components/ui/error-state';
import type { CatalogItemsResponse } from '@/types/jellyfin-streaming';
import type { JellyfinItem } from '@/types/jellyfin';

const SEARCH_GROUPS: Array<{ type: string; title: string }> = [
  { type: 'Movie', title: 'Movies' },
  { type: 'Series', title: 'Shows' },
  { type: 'Episode', title: 'Episodes' },
  { type: 'Person', title: 'People' },
  { type: 'MusicAlbum', title: 'Albums' },
  { type: 'MusicArtist', title: 'Artists' },
  { type: 'Audio', title: 'Songs' },
  { type: 'Playlist', title: 'Playlists' },
  { type: 'BoxSet', title: 'Collections' },
  { type: 'Book', title: 'Books' },
  { type: 'LiveTvChannel', title: 'Live TV' },
  { type: 'Video', title: 'Videos' },
];

function groupItems(items: JellyfinItem[]) {
  const used = new Set<string>();
  return SEARCH_GROUPS
    .map((group) => ({
      ...group,
      items: items.filter((item) => item.Type === group.type),
    }))
    .filter((group) => {
      group.items.forEach((item) => used.add(item.Id));
      return group.items.length > 0;
    })
    .concat([{
      type: 'Other',
      title: 'Other',
      items: items.filter((item) => !used.has(item.Id)),
    }].filter((group) => group.items.length > 0));
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
  const groups = useMemo(() => groupItems(query.data?.items ?? []), [query.data?.items]);

  return (
    <div className="space-y-4 p-4 pb-28">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="sr-only">Search</h1>
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
      {debounced && !query.isFetching && groups.length === 0 && (
        <p className="text-sm text-muted-foreground">No results for “{debounced}”.</p>
      )}
      {groups.map((group) => (
        group.type === 'Audio' ? (
          <div key={group.type} className="space-y-2">
            <h2 className="text-base font-semibold">{group.title}</h2>
            <div className="flex flex-wrap gap-3">
              {group.items.map((item) => (
                <CatalogPosterCard key={item.Id} item={item} onPlay={(next) => void playback.playItem(next)} />
              ))}
            </div>
          </div>
        ) : (
          <CatalogRail
            key={group.type}
            title={group.title}
            items={group.items}
            onPlay={(item) => void playback.playItem(item)}
          />
        )
      ))}
    </div>
  );
}
