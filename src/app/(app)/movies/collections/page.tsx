'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Filter, ArrowUpDown } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { SearchBar } from '@/components/media/search-bar';
import { MoviesSubNav } from '@/components/media/movies-subnav';
import { CollectionCard } from '@/components/media/collection-card';
import { CollectionDetailDrawer } from '@/components/media/collection-detail-drawer';
import { useUIStore } from '@/lib/store';
import { queryKeys } from '@/lib/query-keys';
import { jsonFetcher } from '@/lib/query-fetch';
import type { CollectionSummary } from '@/types';

const EMPTY: CollectionSummary[] = [];

type FilterMode = 'all' | 'missing' | 'complete' | 'monitored';
type SortMode = 'title' | 'missing' | 'size';

const FILTER_LABELS: Record<FilterMode, string> = {
  all: 'All collections',
  missing: 'With missing',
  complete: 'Complete',
  monitored: 'Monitored',
};
const SORT_LABELS: Record<SortMode, string> = {
  title: 'Title',
  missing: 'Missing count',
  size: 'Movie count',
};

export default function MovieCollectionsPage() {
  const instanceFilter = useUIStore((s) => s.moviesInstanceFilter);
  const setInstanceFilter = useUIStore((s) => s.setMoviesInstanceFilter);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [sort, setSort] = useState<SortMode>('title');
  const [selected, setSelected] = useState<CollectionSummary | null>(null);

  // Fetch every instance's collections once and filter client-side (mirrors the Library
  // tab) so the instance picker always lists every connection — not just the active one.
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.collections('radarr'),
    queryFn: jsonFetcher<CollectionSummary[]>('/api/radarr/collections'),
    staleTime: 60_000,
  });
  // Stable empty ref so the memos below don't churn before the query resolves.
  const collections = Array.isArray(data) ? data : EMPTY;

  // Instances present in the data — drives the multi-instance label + filter.
  const instances = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of collections) if (c.instanceId) m.set(c.instanceId, c.instanceLabel ?? c.instanceId);
    return [...m].map(([id, label]) => ({ id, label }));
  }, [collections]);
  const multiInstance = instances.length > 1;

  // Drop a stale instance filter if that instance is no longer connected.
  useEffect(() => {
    if (instanceFilter !== 'all' && collections.length > 0 && !instances.some((i) => i.id === instanceFilter)) {
      setInstanceFilter('all');
    }
  }, [instances, instanceFilter, setInstanceFilter, collections.length]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = collections.filter((c) => {
      if (instanceFilter !== 'all' && c.instanceId !== instanceFilter) return false;
      if (q && !c.title.toLowerCase().includes(q)) return false;
      if (filter === 'missing' && c.missingMovies === 0) return false;
      if (filter === 'complete' && c.missingMovies > 0) return false;
      if (filter === 'monitored' && !c.monitored) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sort === 'missing') return b.missingMovies - a.missingMovies || a.title.localeCompare(b.title);
      if (sort === 'size') return b.movieCount - a.movieCount || a.title.localeCompare(b.title);
      return a.title.localeCompare(b.title);
    });
    return list;
  }, [collections, search, filter, sort, instanceFilter]);

  return (
    <div className="space-y-3 animate-content-in">
      <div
        className="page-toolbar page-toolbar-flush pb-2 app-chrome-bar bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 space-y-2"
      >
        <div className="flex items-center gap-2">
          <MoviesSubNav active="collections" />
          <div className="flex-1 min-w-0">
            <SearchBar
              value={search}
              onChange={setSearch}
              placeholder="Search collections..."
              historyKey="movie-collections"
            />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors"
                aria-label={`Filter: ${FILTER_LABELS[filter]}`}
              >
                <Filter className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Filter</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {(Object.keys(FILTER_LABELS) as FilterMode[]).map((mode) => (
                <DropdownMenuCheckboxItem
                  key={mode}
                  checked={filter === mode}
                  onCheckedChange={() => setFilter(mode)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {FILTER_LABELS[mode]}
                </DropdownMenuCheckboxItem>
              ))}
              {multiInstance && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Instance</DropdownMenuLabel>
                  <DropdownMenuCheckboxItem
                    checked={instanceFilter === 'all'}
                    onCheckedChange={() => setInstanceFilter('all')}
                    onSelect={(e) => e.preventDefault()}
                  >
                    All instances
                  </DropdownMenuCheckboxItem>
                  {instances.map((inst) => (
                    <DropdownMenuCheckboxItem
                      key={inst.id}
                      checked={instanceFilter === inst.id}
                      onCheckedChange={() => setInstanceFilter(inst.id)}
                      onSelect={(e) => e.preventDefault()}
                    >
                      {inst.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors"
                aria-label={`Sort: ${SORT_LABELS[sort]}`}
              >
                <ArrowUpDown className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Sort By</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => (
                <DropdownMenuCheckboxItem
                  key={mode}
                  checked={sort === mode}
                  onCheckedChange={() => setSort(mode)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {SORT_LABELS[mode]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {isLoading && collections.length === 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="aspect-[2/3] rounded-xl" />
              <Skeleton className="h-3 w-3/4 rounded" />
            </div>
          ))}
        </div>
      ) : isError && collections.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>Couldn&apos;t load collections — check the Radarr connection.</p>
          <button
            onClick={() => void refetch()}
            className="mt-3 inline-flex items-center justify-center rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent active:bg-accent/80 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {collections.length === 0
            ? 'No collections found. Collections appear when your Radarr movies belong to a TMDB collection.'
            : 'No collections match your filters.'}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {filtered.map((c, i) => (
            <CollectionCard
              key={`${c.instanceId ?? ''}:${c.id}`}
              collection={c}
              multiInstance={multiInstance}
              imagePriority={i < 4}
              onOpen={() => setSelected(c)}
            />
          ))}
        </div>
      )}

      <CollectionDetailDrawer
        collection={selected}
        multiInstance={multiInstance}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
