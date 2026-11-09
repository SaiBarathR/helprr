'use client';

import {
  ResponsiveMenu,
  ResponsiveMenuActionItem,
  ResponsiveMenuLinkItem,
  ResponsiveMenuSeparator,
} from '@/components/ui/responsive-menu';
import { MarkWatchedMenuItem } from '@/components/jellyfin/mark-watched-button';
import {
  Bookmark, Bell, MoreHorizontal, RefreshCw, Search, ExternalLink,
  Pencil, Trash2, Loader2, Tv, Eye, EyeOff, FileEdit, Sparkles, FileStack,
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
      {/* Monitor toggle — monitoring changes are admin-gated */}
      {canEditMonitoring && (
        <button
          onClick={actions.toggleMonitored}
          disabled={actionLoading === 'monitor'}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center text-primary"
          aria-label="Monitored"
          aria-pressed={series.monitored}
          title={series.monitored ? 'Monitored' : 'Not monitored'}
        >
          {actionLoading === 'monitor' ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : series.monitored ? (
            <Eye className="h-5 w-5" />
          ) : (
            <EyeOff className="h-5 w-5 text-muted-foreground" />
          )}
        </button>
      )}

      {/* 3-dot dropdown */}
      <ResponsiveMenu
        title="More actions"
        actions
        align="end"
        contentClassName="w-52"
        trigger={(
          <button className="min-w-[44px] min-h-[44px] flex items-center justify-center text-primary" aria-label="More actions">
            <MoreHorizontal className="h-5 w-5" />
          </button>
        )}
      >
        {canManageActivity && (
          <ResponsiveMenuActionItem onSelect={actions.refresh} disabled={actionLoading === 'refresh'}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </ResponsiveMenuActionItem>
        )}
        {canManageActivity && (
          <ResponsiveMenuActionItem onSelect={actions.searchAll} disabled={actionLoading === 'search'}>
            <Search className="h-4 w-4" />
            Search Monitored
          </ResponsiveMenuActionItem>
        )}
        {isAnimeSeries && openInAnimeHref && (
          <ResponsiveMenuLinkItem href={openInAnimeHref}>
            <Sparkles className="h-4 w-4" />
            Open in Anime
          </ResponsiveMenuLinkItem>
        )}
        {isAnimeSeries && isAdmin && (
          <ResponsiveMenuActionItem onSelect={() => open('remap')}>
            <Search className="h-4 w-4" />
            Remap AniList
          </ResponsiveMenuActionItem>
        )}
        <ResponsiveMenuSeparator />
        {series.tvdbId > 0 && (
          <ResponsiveMenuLinkItem external href={`https://trakt.tv/search/tvdb/${series.tvdbId}?id_type=show`}>
            <ExternalLink className="h-4 w-4" />
            Open in Trakt
          </ResponsiveMenuLinkItem>
        )}
        {series.imdbId && (
          <ResponsiveMenuLinkItem external href={`https://www.imdb.com/title/${series.imdbId}`}>
            <ExternalLink className="h-4 w-4" />
            Open in IMDb
          </ResponsiveMenuLinkItem>
        )}
        {series.tvdbId > 0 && (
          <ResponsiveMenuLinkItem external href={`https://www.thetvdb.com/?id=${series.tvdbId}&tab=series`}>
            <ExternalLink className="h-4 w-4" />
            Open in TVDB
          </ResponsiveMenuLinkItem>
        )}
        {sonarrExternalUrl && series.titleSlug && (
          <ResponsiveMenuLinkItem external href={`${sonarrExternalUrl}/series/${series.titleSlug}`}>
            <Tv className="h-4 w-4" />
            Open in Sonarr
          </ResponsiveMenuLinkItem>
        )}
        {jellyfinUrl && (series?.imdbId || series?.tvdbId) && (
          <ResponsiveMenuActionItem onSelect={actions.openInJellyfin} disabled={jellyfinLoading}>
            {jellyfinLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
            Open in Jellyfin
          </ResponsiveMenuActionItem>
        )}
        <MarkWatchedMenuItem status={seriesWatch} />
        <ResponsiveMenuSeparator />
        <ResponsiveMenuActionItem onSelect={() => open('watchlist')}>
          <Bookmark className="h-4 w-4" />
          Add to Watchlist…
        </ResponsiveMenuActionItem>
        {canScheduleAlert && (
          <ResponsiveMenuActionItem onSelect={() => open('scheduleAlert')}>
            <Bell className="h-4 w-4" />
            Schedule alert…
          </ResponsiveMenuActionItem>
        )}
        {canEditMonitoring && (
          <ResponsiveMenuActionItem onSelect={() => open('monitor')}>
            <Eye className="h-4 w-4" />
            Monitor
          </ResponsiveMenuActionItem>
        )}
        {canEditSeries && (
          <ResponsiveMenuActionItem onSelect={onEdit}>
            <Pencil className="h-4 w-4" />
            Edit
          </ResponsiveMenuActionItem>
        )}
        {canManageActivity && canManageFiles && (
          <ResponsiveMenuActionItem onSelect={() => open('renamePreview')}>
            <FileEdit className="h-4 w-4" />
            Preview Rename
          </ResponsiveMenuActionItem>
        )}
        {canManageFiles && (
          <ResponsiveMenuActionItem onSelect={onManageEpisodes}>
            <FileStack className="h-4 w-4" />
            Manage Episodes
          </ResponsiveMenuActionItem>
        )}
        {canDeleteSeries && (
          <ResponsiveMenuActionItem destructive onSelect={() => open('delete')}>
            <Trash2 className="h-4 w-4" />
            Delete
          </ResponsiveMenuActionItem>
        )}
      </ResponsiveMenu>
    </div>
  );
}
