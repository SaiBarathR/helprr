'use client';

import { fetchAnilistViewer } from '@/lib/anilist-viewer';
import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ListChecks, Plus } from 'lucide-react';
import { useMe } from '@/components/permission-provider';
import { AnilistStatusDrawer } from '@/components/anime/anilist-status-drawer';
import type { ContextAction } from '@/components/ui/quick-context-menu';
import type { AniListMediaListEntryBase } from '@/lib/anilist-mutations';
import { parseAnilistListEntryResponse } from '@/lib/anilist-list-entry-response';
import { ApiError } from '@/lib/query-fetch';

interface ViewerResponse {
  configured: boolean;
  connected: boolean | null;
  requiresReauth: boolean;
  user?: { scoreFormat: string | null };
}

export interface AnilistContextMedia {
  mediaId: number;
  mediaTitle: string;
  mediaType: 'ANIME' | 'MANGA';
  totalEpisodes?: number | null;
  totalChapters?: number | null;
  totalVolumes?: number | null;
  /** When known (e.g. library list), skip fetch on open. */
  entry?: AniListMediaListEntryBase | null;
}

interface DrawerState extends AnilistContextMedia {
  scoreFormat: string | null;
}

/** Admin + connected AniList account — same gate as AnilistStatusPanel. */
export function useAnilistContextMenu() {
  const me = useMe();
  const isAdmin = me?.role === 'admin';
  const queryClient = useQueryClient();
  const [drawer, setDrawer] = useState<DrawerState | null>(null);

  const viewerQuery = useQuery({
    queryKey: ['anilist', 'viewer'],
    queryFn: ({ signal }) => fetchAnilistViewer<ViewerResponse>(signal),
    enabled: isAdmin,
    staleTime: 60_000,
  });

  const canUseAnilist = isAdmin
    && viewerQuery.data?.connected === true
    && viewerQuery.data?.requiresReauth !== true;

  const entryQuery = useQuery({
    queryKey: ['anilist', 'context-entry', drawer?.mediaId, drawer?.scoreFormat],
    enabled: canUseAnilist && drawer !== null && drawer.entry === undefined,
    // One snapshot per open form; background refresh must not reset edits.
    // Closing changes the key and discards that snapshot for the next open.
    staleTime: Infinity,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/anilist/list-entry?mediaId=${drawer!.mediaId}`, { signal });
      if (!res.ok) throw new ApiError(res.status, 'Could not load the AniList entry');
      return parseAnilistListEntryResponse(await res.json(), drawer!.scoreFormat);
    },
  });

  const openAnilistDrawer = useCallback((media: AnilistContextMedia) => {
    if (!canUseAnilist) return;
    const scoreFormat = viewerQuery.data?.user?.scoreFormat ?? null;
    setDrawer({
      ...media,
      scoreFormat,
    });
  }, [canUseAnilist, viewerQuery.data?.user?.scoreFormat]);

  const buildAnilistContextAction = useCallback((
    media: AnilistContextMedia,
    entryKnown?: AniListMediaListEntryBase | null,
  ): ContextAction | null => {
    if (!canUseAnilist) return null;
    const hasEntry = entryKnown !== undefined ? entryKnown != null : media.entry != null;
    return {
      id: hasEntry ? 'anilist-edit' : 'anilist-add',
      label: hasEntry ? 'Edit score & status…' : 'Add to AniList…',
      icon: hasEntry
        ? <ListChecks className="h-4 w-4" />
        : <Plus className="h-4 w-4" />,
      onSelect: () => {
        void openAnilistDrawer({
          ...media,
          entry: entryKnown !== undefined ? entryKnown : media.entry,
        });
      },
    };
  }, [canUseAnilist, openAnilistDrawer]);

  const invalidateLibrary = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['anilist', 'library'] });
  }, [queryClient]);

  const drawerNode = drawer ? (
    <AnilistStatusDrawer
      open
      onOpenChange={(open) => { if (!open) setDrawer(null); }}
      mediaId={drawer.mediaId}
      mediaTitle={drawer.mediaTitle}
      mediaType={drawer.mediaType}
      totalEpisodes={drawer.totalEpisodes}
      totalChapters={drawer.totalChapters}
      totalVolumes={drawer.totalVolumes}
      entry={drawer.entry !== undefined ? drawer.entry : entryQuery.data ?? null}
      loading={drawer.entry === undefined && (entryQuery.isPending || entryQuery.isFetching)}
      loadError={drawer.entry === undefined && entryQuery.isError && !entryQuery.isFetching}
      onRetry={() => { void entryQuery.refetch(); }}
      scoreFormat={drawer.scoreFormat}
      onSaved={() => {
        invalidateLibrary();
        setDrawer(null);
      }}
      onDeleted={() => {
        invalidateLibrary();
        setDrawer(null);
      }}
    />
  ) : null;

  return {
    canUseAnilist,
    buildAnilistContextAction,
    openAnilistDrawer,
    drawerNode,
  };
}
