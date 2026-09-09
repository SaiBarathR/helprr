'use client';
import { useQueries, useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import type { CatalogHomeResponse } from '@/types/jellyfin-streaming';

// A page's optional shelves never occupy more than three concurrent reads.
let active = 0;
const waiting: Array<() => void> = [];
async function sectionFetch(path: string, signal?: AbortSignal) {
  if (active >= 3) await new Promise<void>((resolve) => waiting.push(resolve));
  else active++;
  try {
    signal?.throwIfAborted();
    return await jsonFetcher<CatalogHomeResponse>(path)({ signal });
  } finally {
    const next = waiting.shift();
    if (next) next(); else active--;
  }
}
export function useCatalogHome() {
  const core = useQuery({
    queryKey: [...queryKeys.jellyfinHome(), 'core'],
    queryFn: jsonFetcher<CatalogHomeResponse>('/api/jellyfin/catalog/home?section=core'),
  });
  const views = (core.data?.views ?? []).filter((view) => !['playlists', 'boxsets'].includes((view.CollectionType || '').toLowerCase())).slice(0, 12);
  const sections = ['favorites', ...views.map((view) => `latest&libraryId=${encodeURIComponent(view.Id)}`)];
  const optional = useQueries({ queries: sections.map((section) => ({
    queryKey: [...queryKeys.jellyfinHome(), section],
    queryFn: ({ signal }: { signal: AbortSignal }) => sectionFetch(`/api/jellyfin/catalog/home?section=${section}`, signal),
    enabled: core.data?.linked === true,
  })) });
  const data = core.data ? {
    ...core.data,
    favorites: optional[0]?.data?.favorites ?? [],
    latest: optional.slice(1).flatMap((query) => query.data?.latest ?? []),
  } : undefined;
  return { ...core, data, optionalFailed: optional.some((query) => query.isError),
    refetch: async () => { await Promise.all([core.refetch(), ...optional.map((query) => query.refetch())]); },
  };
}
