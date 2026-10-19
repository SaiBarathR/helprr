/** What the signed-in user may do on the series page. */
export interface SeriesCaps {
  canManageActivity: boolean;
  canEditMonitoring: boolean;
  canEditSeries: boolean;
  canManageFiles: boolean;
  canDeleteSeries: boolean;
  canScheduleAlert: boolean;
  /** AniList mapping changes are admin-only server-side. */
  isAdmin: boolean;
}

/** The page's dialogs and drawers a section can open. */
export type SeriesDialog = 'remap' | 'watchlist' | 'scheduleAlert' | 'renamePreview' | 'delete' | 'monitor';
