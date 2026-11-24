// Settings → Service status, for admins: each Sonarr, Radarr, Lidarr and
// Prowlarr instance's version, scheduled tasks and recent warnings, as its own
// System pages show them. Shared by the routes and the sheet; no server imports.

export type SystemServiceType = 'SONARR' | 'RADARR' | 'LIDARR' | 'PROWLARR';

export const SYSTEM_SERVICE_TYPES: readonly SystemServiceType[] = ['SONARR', 'RADARR', 'LIDARR', 'PROWLARR'];

export function isSystemServiceType(type: unknown): type is SystemServiceType {
  return typeof type === 'string' && (SYSTEM_SERVICE_TYPES as readonly string[]).includes(type);
}

/**
 * The scheduled tasks Run now may start, per app, by task name: the app's own
 * scheduled work, which can neither install an update nor delete files,
 * library titles or history. Some do real work, as on their schedule: RSS
 * Sync can grab, Refresh Monitored Downloads (every minute anyway) imports
 * finished downloads, a refresh run by hand rescans every title rather than
 * the stale ones, Refresh Collections adds a monitored collection's missing
 * movies, and Prowlarr's Application Indexer Sync pushes indexers to the apps
 * (removing others in Full Sync). RSS Sync and the refreshes are already
 * admin-only library commands, and Indexer Sync a prowlarr.manage command.
 * Left out, on purpose:
 * - ApplicationUpdateCheck (Radarr: ApplicationCheckUpdate): when the app is
 *   set to update automatically, a check that finds an update installs it.
 * - CleanUpRecycleBin: deletes files from disk.
 * - ImportListSync: its list clean-up can unmonitor or delete titles (Radarr
 *   can delete their files too).
 * - RescanFolders (Lidarr): scans every root folder and can add artists for
 *   the files it finds.
 * - CleanUpHistory (Prowlarr): deletes history.
 * Any task not named here (a new one in a later version too) is shown without
 * Run now.
 */
export const RUNNABLE_TASKS: Readonly<Record<SystemServiceType, ReadonlySet<string>>> = {
  SONARR: new Set([
    'RssSync',
    'RefreshMonitoredDownloads',
    'CheckHealth',
    'RefreshSeries',
    'UpdateSceneMapping',
    'Housekeeping',
    'Backup',
    'MessagingCleanup',
  ]),
  RADARR: new Set([
    'RssSync',
    'RefreshMonitoredDownloads',
    'CheckHealth',
    'RefreshMovie',
    'RefreshCollections',
    'Housekeeping',
    'Backup',
    'MessagingCleanup',
    'ClearExpiredCache',
  ]),
  LIDARR: new Set([
    'RssSync',
    'RefreshMonitoredDownloads',
    'CheckHealth',
    'RefreshArtist',
    'Housekeeping',
    'Backup',
    'MessagingCleanup',
  ]),
  PROWLARR: new Set([
    'CheckHealth',
    'ApplicationIndexerSync',
    'IndexerDefinitionUpdate',
    'Housekeeping',
    'Backup',
    'MessagingCleanup',
    'ClearExpiredCache',
  ]),
};

export interface ArrSystemStatus {
  version: string;
  branch: string;
  /** The newer version the app offers, or null when it is up to date. */
  updateVersion: string | null;
  /** False when the app could not be asked for updates (its update server unreachable, say). */
  updateChecked: boolean;
}

export interface ArrSystemTask {
  /** The command name, e.g. "RssSync". */
  taskName: string;
  /** As the app labels it, e.g. "Rss Sync". */
  name: string;
  intervalMinutes: number;
  lastExecution: string | null;
  nextExecution: string | null;
  /** How long the last run took, in seconds, or null. */
  lastDurationSeconds: number | null;
  canRun: boolean;
}

export type ArrLogLevel = 'warn' | 'error';

export interface ArrLogEntry {
  id: number;
  time: string;
  level: string;
  logger: string;
  message: string;
  /** The exception type and text, when the entry has one; '' otherwise. */
  exception: string;
}

export interface ArrLogPage {
  page: number;
  pageSize: number;
  totalRecords: number;
  entries: ArrLogEntry[];
}

export const ARR_LOG_PAGE_SIZE = 50;
