'use client';

import Link from '@/components/ui/app-link';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MarkWatchedMenuItem } from '@/components/jellyfin/mark-watched-button';
import {
  Bookmark, Bell, MoreHorizontal, RefreshCw, Search, ExternalLink,
  Pencil, Trash2, Loader2, Tv, Eye, FileEdit, Sparkles, FileStack,
} from 'lucide-react';
import type { SonarrSeries } from '@/types';
import type { WatchStatus } from '@/types/watch-status';
import type { SeriesActions } from './use-series-actions';
import type { SeriesCaps, SeriesDialog } from './types';

/** The page header's right side: the monitored bookmark and the actions menu. */
export function SeriesHeaderActions({
  series,
  refreshing,
  caps,
  actions,
  isAnimeSeries,
  openInAnimeHref,
  sonarrExternalUrl,
  jellyfinUrl,
  seriesWatch,
  open,
  onEdit,
  onManageEpisodes,
}: {
  series: SonarrSeries;
  refreshing: boolean;
  caps: SeriesCaps;
  actions: SeriesActions;
  isAnimeSeries: boolean;
  openInAnimeHref: string | null;
  sonarrExternalUrl: string | null | undefined;
  jellyfinUrl: string | undefined;
  seriesWatch: WatchStatus | undefined;
  open: (dialog: SeriesDialog) => void;
  onEdit: () => void;
  onManageEpisodes: () => void;
}) {
  const { canManageActivity, canEditMonitoring, canEditSeries, canManageFiles, canDeleteSeries, canScheduleAlert, isAdmin } = caps;
  const { actionLoading, jellyfinLoading } = actions;
  return (
    <div className="flex items-center gap-0.5">
      {refreshing && (
        <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground mr-1" />
      )}
      {/* Bookmark / Monitor toggle — monitoring changes are admin-gated */}
      {canEditMonitoring && (
        <button
          onClick={actions.toggleMonitored}
          disabled={actionLoading === 'monitor'}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center text-primary"
          aria-label="Monitored"
          aria-pressed={series.monitored}
        >
          {actionLoading === 'monitor' ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : series.monitored ? (
            <Bookmark className="h-5 w-5 fill-current" />
          ) : (
            <Bookmark className="h-5 w-5" />
          )}
        </button>
      )}

      {/* 3-dot dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="min-w-[44px] min-h-[44px] flex items-center justify-center text-primary" aria-label="More actions">
            <MoreHorizontal className="h-5 w-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {canManageActivity && (
            <DropdownMenuItem onClick={actions.refresh} disabled={actionLoading === 'refresh'}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </DropdownMenuItem>
          )}
          {canManageActivity && (
            <DropdownMenuItem onClick={actions.searchAll} disabled={actionLoading === 'search'}>
              <Search className="h-4 w-4" />
              Search Monitored
            </DropdownMenuItem>
          )}
          {isAnimeSeries && openInAnimeHref && (
            <DropdownMenuItem asChild>
              <Link href={openInAnimeHref}>
                <Sparkles className="h-4 w-4" />
                Open in Anime
              </Link>
            </DropdownMenuItem>
          )}
          {isAnimeSeries && isAdmin && (
            <DropdownMenuItem onClick={() => open('remap')}>
              <Search className="h-4 w-4" />
              Remap AniList
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          {series.tvdbId > 0 && (
            <DropdownMenuItem asChild>
              <a href={`https://trakt.tv/search/tvdb/${series.tvdbId}?id_type=show`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
                Open in Trakt
              </a>
            </DropdownMenuItem>
          )}
          {series.imdbId && (
            <DropdownMenuItem asChild>
              <a href={`https://www.imdb.com/title/${series.imdbId}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
                Open in IMDb
              </a>
            </DropdownMenuItem>
          )}
          {series.tvdbId > 0 && (
            <DropdownMenuItem asChild>
              <a href={`https://www.thetvdb.com/?id=${series.tvdbId}&tab=series`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
                Open in TVDB
              </a>
            </DropdownMenuItem>
          )}
          {sonarrExternalUrl && series.titleSlug && (
            <DropdownMenuItem asChild>
              <a href={`${sonarrExternalUrl}/series/${series.titleSlug}`} target="_blank" rel="noopener noreferrer">
                <Tv className="h-4 w-4" />
                Open in Sonarr
              </a>
            </DropdownMenuItem>
          )}
          {jellyfinUrl && (series?.imdbId || series?.tvdbId) && (
            <DropdownMenuItem onClick={actions.openInJellyfin} disabled={jellyfinLoading}>
              {jellyfinLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
              Open in Jellyfin
            </DropdownMenuItem>
          )}
          <MarkWatchedMenuItem status={seriesWatch} />
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => open('watchlist')}>
            <Bookmark className="h-4 w-4" />
            Add to Watchlist…
          </DropdownMenuItem>
          {canScheduleAlert && (
            <DropdownMenuItem onClick={() => open('scheduleAlert')}>
              <Bell className="h-4 w-4" />
              Schedule alert…
            </DropdownMenuItem>
          )}
          {canEditMonitoring && (
            <DropdownMenuItem onClick={() => open('monitor')}>
              <Eye className="h-4 w-4" />
              Monitor
            </DropdownMenuItem>
          )}
          {canEditSeries && (
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="h-4 w-4" />
              Edit
            </DropdownMenuItem>
          )}
          {canManageActivity && (
            <DropdownMenuItem onClick={() => open('renamePreview')}>
              <FileEdit className="h-4 w-4" />
              Preview Rename
            </DropdownMenuItem>
          )}
          {canManageFiles && (
            <DropdownMenuItem onClick={onManageEpisodes}>
              <FileStack className="h-4 w-4" />
              Manage Episodes
            </DropdownMenuItem>
          )}
          {canDeleteSeries && (
            <DropdownMenuItem variant="destructive" onClick={() => open('delete')}>
              <Trash2 className="h-4 w-4" />
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
