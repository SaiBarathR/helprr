'use client';

import { useEffect, useState } from 'react';
import Link from '@/components/ui/app-link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ListSkeleton } from '@/components/ui/list-skeleton';
import { QuickContextMenu } from '@/components/ui/quick-context-menu';
import {
  Download,
  Loader2,
  Search,
  Tv,
  Film,
  Disc3,
  Scissors,
  ExternalLink,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { useRestorableInfiniteQuery as useInfiniteQuery } from '@/lib/hooks/use-restorable-infinite-query';
import { keepPreviousData } from '@tanstack/react-query';
import { ApiError } from '@/lib/query-fetch';
import { useCan } from '@/components/permission-provider';
import { TabErrorState } from './shared';

// --- Wanted Tab ---

interface WantedRecord {
  id: number;
  source: 'sonarr' | 'radarr' | 'lidarr';
  instanceId?: string;
  instanceLabel?: string;
  mediaType: 'episode' | 'movie' | 'album';
  title?: string;
  seriesId?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  airDateUtc?: string;
  airDate?: string;
  series?: { id: number; title: string };
  year?: number;
  added?: string;
  monitored?: boolean;
  // Lidarr album fields
  artistId?: number;
  albumId?: number;
  releaseDate?: string;
  artist?: { id: number; artistName: string };
}

// Row identity for list keys and per-item search state: multi-instance setups
// can repeat a (source, id) pair, so the instance must be part of the key.
function wantedRecordKey(record: WantedRecord): string {
  return `${record.source}-${record.instanceId ?? 'default'}-${record.id}`;
}

/**
 * Render the Wanted tab showing either missing or cutoff items with per-item search and pagination.
 *
 * @param type - Specifies which set of wanted items to display: `'missing'` or `'cutoff'`.
 * @param filterBy - Selected sources for results (`'sonarr'`, `'radarr'`, `'lidarr'`); an empty array means all sources, otherwise results are limited to the selected sources.
 * @returns The tab content element that lists records, shows loading and empty states, provides a per-record search action, and supports "Load more" pagination.
 */

export function WantedTab({ type, filterBy, instanceFilter }: { type: 'missing' | 'cutoff'; filterBy: string[]; instanceFilter: string }) {
  const PAGE_SIZE = 20;
  const canManageActivity = useCan('activity.manage');
  // Keyed per item: overlapping searches on two items must not clear each
  // other's spinner (a single string flag would).
  const [searching, setSearching] = useState<ReadonlySet<string>>(new Set());

  // The server filters and paginates for exactly this source set + instance, so
  // every filter combination is a genuinely different result — key on all of them
  // and request the page directly. No client-side filtering, no auto-advance.
  const wantedQuery = useInfiniteQuery({
    queryKey: ['activity', 'wanted', type, [...filterBy].sort().join(',') || 'all', instanceFilter],
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ type, page: String(pageParam), pageSize: String(PAGE_SIZE) });
      if (filterBy.length > 0) params.set('sources', filterBy.join(','));
      if (instanceFilter !== 'all') params.set('instanceId', instanceFilter);
      const res = await fetch(`/api/activity/wanted?${params}`, { signal });
      if (!res.ok) throw new ApiError(res.status, `GET /api/activity/wanted → ${res.status}`);
      return (await res.json()) as { records: WantedRecord[]; totalRecords: number };
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) =>
      allPages.length * PAGE_SIZE < (lastPage.totalRecords || 0) ? allPages.length + 1 : undefined,
    // Keep the current results visible while a filter change refetches,
    // instead of blanking to a full-screen spinner.
    placeholderData: keepPreviousData,
  });
  const loading = wantedQuery.isLoading;
  const records = wantedQuery.data?.pages.flatMap((pg) => pg.records ?? []) ?? [];

  // Surface fetch failures instead of silently rendering "No missing items" (or
  // stale rows under keepPreviousData). Mirrors the toast-on-error the action
  // handlers use; errorUpdatedAt re-fires it once per distinct failure.
  useEffect(() => {
    if (wantedQuery.isError) {
      toast.error('Failed to load wanted items');
    }
  }, [wantedQuery.isError, wantedQuery.errorUpdatedAt]);

  async function handleSearch(record: WantedRecord) {
    const key = wantedRecordKey(record);
    setSearching((prev) => new Set(prev).add(key));
    // Route the search command to the instance the wanted item lives on.
    const qs = record.instanceId ? `?instanceId=${record.instanceId}` : '';
    try {
      let res: Response;
      if (record.source === 'sonarr') {
        res = await fetch(`/api/sonarr/command${qs}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'EpisodeSearch', episodeIds: [record.id] }),
        });
      } else if (record.source === 'lidarr') {
        res = await fetch(`/api/lidarr/command${qs}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'AlbumSearch', albumIds: [record.id] }),
        });
      } else {
        res = await fetch(`/api/radarr/command${qs}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'MoviesSearch', movieIds: [record.id] }),
        });
      }
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      toast.success('Search started');
    } catch { toast.error('Search failed'); }
    finally {
      setSearching((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  if (loading) {
    return <ListSkeleton />;
  }

  if (records.length === 0) {
    if (wantedQuery.isError) {
      return <TabErrorState message="Couldn't load wanted items" onRetry={() => wantedQuery.refetch()} />;
    }
    return (
      <div className="text-center py-16 text-muted-foreground">
        {type === 'missing' ? (
          <>
            <Download className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No missing items</p>
          </>
        ) : (
          <>
            <Scissors className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No cutoff unmet items</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1 animate-list-in">
      {records.map((record) => {
        const key = wantedRecordKey(record);
        const isEpisode = record.mediaType === 'episode';
        const isAlbum = record.mediaType === 'album';
        const albumYear = record.releaseDate ? new Date(record.releaseDate).getFullYear() : undefined;
        const displayTitle = isEpisode
          ? `${record.series?.title || 'Unknown'} - S${String(record.seasonNumber ?? 0).padStart(2, '0')}E${String(record.episodeNumber ?? 0).padStart(2, '0')} - ${record.title || 'TBA'}`
          : isAlbum
            ? `${record.artist?.artistName ? `${record.artist.artistName} - ` : ''}${record.title || 'Unknown'}${albumYear ? ` (${albumYear})` : ''}`
            : `${record.title || 'Unknown'} (${record.year || '?'})`;
        const dateStr = isEpisode ? record.airDateUtc || record.airDate : isAlbum ? record.releaseDate : record.added;

        const hasSeriesId = Number.isFinite(record.seriesId);
        const hasSeasonNumber = Number.isFinite(record.seasonNumber);
        const q = record.instanceId ? `?instance=${record.instanceId}` : '';
        const href = isAlbum
          ? `/music/album/${record.id}${q}`
          : isEpisode && hasSeriesId && hasSeasonNumber
            ? `/series/${record.seriesId}/season/${record.seasonNumber}/episode/${record.id}${q}`
            : isEpisode && hasSeriesId
              ? `/series/${record.seriesId}${q}`
              : !isEpisode
                ? `/movies/${record.id}${q}`
                : null;

        return (
          <QuickContextMenu
            key={key}
            label={`Actions for ${displayTitle}`}
            groups={[
              {
                id: 'actions',
                actions: [
                  ...(href
                    ? [{
                      id: 'open-media',
                      label: 'Open related media',
                      icon: <ExternalLink className="h-4 w-4" />,
                      href,
                    }]
                    : []),
                  ...(canManageActivity
                    ? [{
                      id: 'search-release',
                      label: 'Search for release',
                      icon: <Search className="h-4 w-4" />,
                      pending: searching.has(key),
                      onSelect: () => void handleSearch(record),
                    }]
                    : []),
                ],
              },
            ]}
          >
            <div className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/50 active:bg-muted/50 transition-colors">
              {href ? (
                <Link href={href} className="p-1.5 rounded bg-muted hover:bg-muted/80 transition-colors">
                  {isEpisode ? <Tv className="h-3.5 w-3.5 text-muted-foreground" /> : isAlbum ? <Disc3 className="h-3.5 w-3.5 text-muted-foreground" /> : <Film className="h-3.5 w-3.5 text-muted-foreground" />}
                </Link>
              ) : (
                <div className="p-1.5 rounded bg-muted">
                  {isEpisode ? <Tv className="h-3.5 w-3.5 text-muted-foreground" /> : isAlbum ? <Disc3 className="h-3.5 w-3.5 text-muted-foreground" /> : <Film className="h-3.5 w-3.5 text-muted-foreground" />}
                </div>
              )}
              <div className="flex-1 min-w-0">
                {href ? (
                  <Link href={href} className="block">
                    <p className="text-sm truncate">{displayTitle}</p>
                  </Link>
                ) : (
                  <p className="text-sm truncate">{displayTitle}</p>
                )}
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">{record.source}</Badge>
                  {dateStr && (
                    <span>{formatDistanceToNow(new Date(dateStr), { addSuffix: true })}</span>
                  )}
                </div>
              </div>
              {canManageActivity && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 shrink-0"
                  onClick={() => handleSearch(record)}
                  disabled={searching.has(key)}
                >
                  {searching.has(key) ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Search className="h-3.5 w-3.5" />
                  )}
                </Button>
              )}
            </div>
          </QuickContextMenu>
        );
      })}
      {wantedQuery.hasNextPage && (
        <Button
          variant="ghost"
          className="w-full"
          onClick={() => wantedQuery.fetchNextPage()}
          disabled={wantedQuery.isFetchingNextPage}
        >
          {wantedQuery.isFetchingNextPage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Load more
        </Button>
      )}
    </div>
  );
}
