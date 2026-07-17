'use client';

import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ListChecks, Plus } from 'lucide-react';
import { useMe } from '@/components/permission-provider';
import { AnilistStatusDrawer } from '@/components/anime/anilist-status-drawer';
import type { ContextAction } from '@/components/ui/quick-context-menu';
import type { AniListMediaListEntryBase } from '@/lib/anilist-mutations';
import { parseAnilistListEntryResponse } from '@/lib/anilist-list-entry-response';

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
  entry: AniListMediaListEntryBase | null;
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
    queryFn: async ({ signal }): Promise<ViewerResponse> => {
      const res = await fetch('/api/anilist/viewer', { signal });
      if (!res.ok) return { configured: false, connected: false, requiresReauth: false };
      return (await res.json()) as ViewerResponse;
    },
    enabled: isAdmin,
    staleTime: 60_000,
  });

  const canUseAnilist = isAdmin
    && viewerQuery.data?.connected === true
    && viewerQuery.data?.requiresReauth !== true;

  const openAnilistDrawer = useCallback(async (media: AnilistContextMedia) => {
    if (!canUseAnilist) return;
    const scoreFormat = viewerQuery.data?.user?.scoreFormat ?? null;
    let entry = media.entry ?? null;
    if (media.entry === undefined) {
      try {
        const res = await fetch(`/api/anilist/list-entry?mediaId=${media.mediaId}`);
        if (res.ok) {
          const data = await res.json();
          entry = parseAnilistListEntryResponse(data, scoreFormat);
        }
      } catch {
        entry = null;
      }
    }
    setDrawer({
      ...media,
      entry,
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
      entry={drawer.entry}
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
