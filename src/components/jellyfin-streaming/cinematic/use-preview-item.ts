'use client';

import { useQuery } from '@tanstack/react-query';
import type { JellyfinItem } from '@/types/jellyfin';
import type { CatalogItemsResponse } from '@/types/jellyfin-streaming';

/** What a preview should sample from, once folders have been resolved. */
export interface PreviewSource {
  itemId?: string;
  runtimeTicks?: number;
}

/**
 * The item a preview clip should actually be sampled from.
 *
 * A Series or a Season has no media source of its own, so `/PlaybackInfo` on
 * one fails outright — Jellyfin answers "Failed to start playback" and the
 * request comes back 500. That is why the billboard, every series card and
 * every series detail page showed nothing but still art no matter how long you
 * waited: the whole spotlight is series, and the one call a preview makes could
 * never have succeeded for any of them.
 *
 * Netflix previews the *show*, so resolve the episode a viewer would land on:
 * their own Next Up, falling back to the first episode for a series nobody has
 * started. Anything else that is a folder — a box set, an album, a playlist —
 * has no single representative episode and keeps its artwork.
 *
 * The runtime comes back with the episode, because the caller's own
 * RunTimeTicks belongs to the series (or is absent) and the sample offset is
 * derived from it.
 */
export function usePreviewSource(
  item: JellyfinItem | null | undefined,
  enabled: boolean,
): PreviewSource {
  const isEpisodicFolder = item?.Type === 'Series' || item?.Type === 'Season';
  // The episode list is scoped to whatever was asked for — a season, or the
  // whole series. Next Up is only consulted for a series: it has no season
  // filter upstream, so on a season page it could hand back an episode from a
  // different one, and the season's own first episode is the better sample.
  const parentId = isEpisodicFolder ? item.Id : undefined;
  const seriesId = item?.Type === 'Series' ? item.Id : undefined;

  const query = useQuery({
    queryKey: ['jellyfin', 'catalog', 'preview-source', parentId],
    queryFn: async (): Promise<JellyfinItem | null> => {
      if (seriesId) {
        const nextUp = await fetch(`/api/jellyfin/catalog/next-up?seriesId=${encodeURIComponent(seriesId)}`)
          .then((res) => (res.ok ? (res.json() as Promise<CatalogItemsResponse>) : null))
          .catch(() => null);
        if (nextUp?.items?.[0]) return nextUp.items[0];
      }

      // Next Up is empty for a fully-watched show and for one Jellyfin has no
      // history on, so neither case can rely on it.
      const first = await fetch(
        `/api/jellyfin/catalog/items?parentId=${encodeURIComponent(parentId!)}`
        + '&includeItemTypes=Episode&recursive=true&sortBy=ParentIndexNumber,IndexNumber&limit=1',
      )
        .then((res) => (res.ok ? (res.json() as Promise<CatalogItemsResponse>) : null))
        .catch(() => null);
      return first?.items?.[0] ?? null;
    },
    enabled: enabled && Boolean(parentId),
    // The answer only changes when the viewer's progress does, and a preview is
    // scenery — it is not worth a request per hover.
    staleTime: 10 * 60_000,
  });

  if (!item) return {};
  if (!item.IsFolder) return { itemId: item.Id, runtimeTicks: item.RunTimeTicks };
  if (!isEpisodicFolder) return {};
  const episode = query.data;
  return episode ? { itemId: episode.Id, runtimeTicks: episode.RunTimeTicks } : {};
}
