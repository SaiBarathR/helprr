// Settings → Service status, for admins: each Sonarr, Radarr, Lidarr and
// Prowlarr instance's version, scheduled tasks, recent warnings and backups,
// and restarting or shutting it down, as its own System pages offer them.
// Shared by the routes and the sheet; no server imports.

export type SystemServiceType = 'SONARR' | 'RADARR' | 'LIDARR' | 'PROWLARR';

export const SYSTEM_SERVICE_TYPES: readonly SystemServiceType[] = ['SONARR', 'RADARR', 'LIDARR', 'PROWLARR'];

export function isSystemServiceType(type: unknown): type is SystemServiceType {
  return typeof type === 'string' && (SYSTEM_SERVICE_TYPES as readonly string[]).includes(type);
}

/**
 * The scheduled tasks Run now may start, per app, by task name: the app's own
 * scheduled work, which can neither install an update nor delete files or
 * library titles (Housekeeping clears only history and other rows left by
 * titles already deleted). Some do real work, as on their schedule: RSS
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

/** Restart or shut down, as the app's System → Status offers them. */
export type ArrPowerAction = 'restart' | 'shutdown';

export function isArrPowerAction(value: unknown): value is ArrPowerAction {
  return value === 'restart' || value === 'shutdown';
}

/** One backup as the app's System → Backup lists it, without its path. */
export interface ArrBackup {
  /** The app's own id for it (a hash of its type and name). */
  id: number;
  name: string;
  type: 'scheduled' | 'manual' | 'update';
  size: number;
  time: string;
}

/**
 * What an admin types to restore or delete a backup, checked again by the
 * route. Fixed words, not the backup's name, so they are easy to type on a phone.
 */
export const BACKUP_RESTORE_PHRASE = 'RESTORE';
export const BACKUP_DELETE_PHRASE = 'DELETE';

/**
 * The largest backup file Helprr takes to restore. Helprr's request proxy
 * keeps at most 10 MiB of a request body and silently drops the rest, so a
 * larger file would arrive cut short; the form fields take the few bytes left.
 */
export const BACKUP_UPLOAD_MAX_BYTES = 10 * 1024 * 1024 - 64 * 1024;
