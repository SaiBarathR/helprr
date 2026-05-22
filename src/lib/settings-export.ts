import type { ServiceType } from '@prisma/client';
import { EVENT_TYPES, type NotificationEventType } from '@/lib/notification-events';
import { STORE_VERSION } from '@/lib/store';
import type {
  DownloadCleanerConfigShape,
  QueueCleanerConfigShape,
  SeedingRuleShape,
  SlowRuleShape,
  StallRuleShape,
} from '@/lib/cleanup/types';

export const EXPORT_FORMAT_KIND = 'helprr-settings-export';
export const EXPORT_FORMAT_VERSION = 1;
// Max import payload size. Watchlist + dashboard layouts can push past 1 MiB.
export const MAX_IMPORT_BYTES = 2_097_152;

export type UiPrefCategoryId =
  | 'navigation'
  | 'mediaViews'
  | 'discover'
  | 'anime'
  | 'torrents'
  | 'activity'
  | 'notificationFilters'
  | 'calendar'
  | 'cleanup'
  | 'dashboardTheme';

export const UI_PREF_CATEGORY_LABELS: Record<UiPrefCategoryId, string> = {
  navigation: 'Navigation',
  mediaViews: 'Movies & series views',
  discover: 'Discover',
  anime: 'Anime',
  torrents: 'Torrents',
  activity: 'Activity',
  notificationFilters: 'Notification filters',
  calendar: 'Calendar',
  cleanup: 'Cleanup history filters',
  dashboardTheme: 'Dashboard theme',
};

export const UI_PREF_CATEGORY_FIELDS: Record<UiPrefCategoryId, readonly string[]> = {
  navigation: ['navPosition', 'navOrder', 'disabledNavItems', 'defaultPage', 'sidebarCollapsed'],
  mediaViews: [
    'mediaView',
    'moviesView', 'moviesPosterSize', 'moviesSort', 'moviesSearch',
    'moviesSortDirection', 'moviesFilter', 'moviesVisibleFields',
    'seriesView', 'seriesPosterSize', 'seriesSort', 'seriesSearch',
    'seriesSortDirection', 'seriesFilter', 'seriesVisibleFields',
  ],
  discover: ['discoverContentType', 'discoverSort', 'discoverSortDirection', 'discoverFilters'],
  anime: ['animeSort', 'animeFilters', 'animeCarouselOrder', 'disabledAnimeCarousels'],
  torrents: ['torrentsFilter', 'torrentsSortKey', 'torrentsSortDir'],
  activity: ['activityTab', 'activitySortBy', 'activityFilterBy'],
  notificationFilters: ['notificationsFilters'],
  calendar: ['calendarView', 'calendarTypeFilter', 'calendarMonitoredOnly'],
  cleanup: ['cleanupHistoryFilters'],
  dashboardTheme: [
    'dashboardAccent', 'dashboardPalette', 'dashboardGradient', 'dashboardFont',
    'dashboardFg', 'dashboardFgMute', 'dashboardFgSubtle',
  ],
};

export const UI_PREF_CATEGORY_IDS: readonly UiPrefCategoryId[] = Object.keys(
  UI_PREF_CATEGORY_FIELDS
) as UiPrefCategoryId[];

export const SERVICE_TYPES_EXPORTABLE: readonly ServiceType[] = [
  'RADARR', 'SONARR', 'QBITTORRENT', 'PROWLARR', 'JELLYFIN', 'TMDB', 'ANILIST',
] as const;

export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  RADARR: 'Radarr',
  SONARR: 'Sonarr',
  QBITTORRENT: 'qBittorrent',
  PROWLARR: 'Prowlarr',
  JELLYFIN: 'Jellyfin',
  TMDB: 'TMDB',
  ANILIST: 'AniList',
};

export interface ExportedServiceConnection {
  type: ServiceType;
  url: string;
  externalUrl: string | null;
  username: string | null;
  apiKey: string | null;
  accessToken: string | null;
  refreshToken: string | null;
}

export interface ExportedAppSettings {
  pollingIntervalSecs: number;
  activityRefreshIntervalSecs: number;
  torrentsRefreshIntervalSecs: number;
  cacheImagesEnabled: boolean;
  timeZone: string;
  logEnabled: boolean;
  logLevel: string;
  logMaxFileMb: number;
  logRetentionDays: number;
  logClientConsoleEnabled: boolean;
  logFailedRequestBodies: boolean;
  logFailedResponseBodies: boolean;
  upcomingAlertHours: number;
  upcomingNotifyMode: string;
  upcomingNotifyBeforeMins: number;
  upcomingDailyNotifyHour: number;
}

export interface ExportedNotificationRule {
  eventType: NotificationEventType;
  enabled: boolean;
  tagFilter: string | null;
  qualityFilter: string | null;
}

export interface ExportedNotificationDevice {
  deviceName: string;
  rules: ExportedNotificationRule[];
}

export interface ExportedCleanup {
  queueConfig: QueueCleanerConfigShape;
  downloadConfig: DownloadCleanerConfigShape;
  stallRules: StallRuleShape[];
  slowRules: SlowRuleShape[];
  // System-managed seeding rules (the auto-remove-imported synthetic rule) are
  // excluded — they're regenerated from downloadConfig on import.
  seedingRules: SeedingRuleShape[];
}

export interface ExportedDashboardLayout {
  name: string;
  isBuiltIn: boolean;
  slug: 'desktop' | 'mobile' | null;
  // Widget instances — validated at import via the dashboard-layouts validators.
  widgets: unknown[];
}

export interface ExportedDashboardLayouts {
  layouts: ExportedDashboardLayout[];
  // Default-layout references by name (IDs are install-local). Built-ins can
  // also be matched via slug as a fallback.
  defaultDesktopLayoutName: string | null;
  defaultMobileLayoutName: string | null;
}

export interface ExportedWatchlistTag {
  name: string;
  color: string | null;
}

export interface ExportedWatchlistItem {
  source: string;
  externalId: string;
  mediaType: string;
  title: string;
  year: number | null;
  posterUrl: string | null;
  overview: string | null;
  rating: number | null;
  addedAt: string;
  reminderAt: string | null;
  tags: string[];
}

export interface ExportedWatchlist {
  items: ExportedWatchlistItem[];
  tags: ExportedWatchlistTag[];
}

export interface SettingsExportPayload {
  kind: typeof EXPORT_FORMAT_KIND;
  version: number;
  exportedAt: string;
  zustandVersion: number;
  includesSecrets: boolean;
  uiPrefs?: Partial<Record<UiPrefCategoryId, Record<string, unknown>>>;
  appSettings?: ExportedAppSettings;
  serviceConnections?: ExportedServiceConnection[];
  notificationPrefs?: ExportedNotificationDevice[];
  cleanup?: ExportedCleanup;
  discoverLayout?: Record<string, unknown>;
  dashboardLayouts?: ExportedDashboardLayouts;
  watchlist?: ExportedWatchlist;
}

export function extractUiPrefsByCategory(
  state: Record<string, unknown>,
  categoryId: UiPrefCategoryId
): Record<string, unknown> {
  const fields = UI_PREF_CATEGORY_FIELDS[categoryId];
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in state) result[field] = state[field];
  }
  return result;
}

export interface ImportValidationOk {
  ok: true;
  payload: SettingsExportPayload;
  warnings: string[];
}

export interface ImportValidationError {
  ok: false;
  error: string;
}

export function validateImportFile(
  raw: unknown
): ImportValidationOk | ImportValidationError {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'File is not a valid JSON object.' };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.kind !== EXPORT_FORMAT_KIND) {
    return { ok: false, error: 'This does not look like a Helprr settings export.' };
  }
  if (typeof obj.version !== 'number' || obj.version > EXPORT_FORMAT_VERSION) {
    return {
      ok: false,
      error: `Unsupported export format version (${String(obj.version)}). Update Helprr and try again.`,
    };
  }
  const zustandVersion = typeof obj.zustandVersion === 'number' ? obj.zustandVersion : 0;
  if (zustandVersion > STORE_VERSION) {
    return {
      ok: false,
      error: 'This export was created by a newer version of Helprr. Update first, then import.',
    };
  }

  const warnings: string[] = [];

  if (obj.uiPrefs !== undefined && (typeof obj.uiPrefs !== 'object' || obj.uiPrefs === null)) {
    return { ok: false, error: 'Invalid uiPrefs section.' };
  }
  if (obj.appSettings !== undefined && (typeof obj.appSettings !== 'object' || obj.appSettings === null)) {
    return { ok: false, error: 'Invalid appSettings section.' };
  }
  if (obj.serviceConnections !== undefined && !Array.isArray(obj.serviceConnections)) {
    return { ok: false, error: 'Invalid serviceConnections section.' };
  }
  if (obj.notificationPrefs !== undefined && !Array.isArray(obj.notificationPrefs)) {
    return { ok: false, error: 'Invalid notificationPrefs section.' };
  }
  if (obj.cleanup !== undefined && (typeof obj.cleanup !== 'object' || obj.cleanup === null)) {
    return { ok: false, error: 'Invalid cleanup section.' };
  }
  if (
    obj.discoverLayout !== undefined &&
    (typeof obj.discoverLayout !== 'object' ||
      obj.discoverLayout === null ||
      Array.isArray(obj.discoverLayout))
  ) {
    return { ok: false, error: 'Invalid discoverLayout section.' };
  }
  if (
    obj.dashboardLayouts !== undefined &&
    (typeof obj.dashboardLayouts !== 'object' ||
      obj.dashboardLayouts === null ||
      Array.isArray(obj.dashboardLayouts) ||
      !Array.isArray((obj.dashboardLayouts as { layouts?: unknown }).layouts))
  ) {
    return { ok: false, error: 'Invalid dashboardLayouts section.' };
  }
  if (
    obj.watchlist !== undefined &&
    (typeof obj.watchlist !== 'object' ||
      obj.watchlist === null ||
      Array.isArray(obj.watchlist) ||
      !Array.isArray((obj.watchlist as { items?: unknown }).items))
  ) {
    return { ok: false, error: 'Invalid watchlist section.' };
  }

  if (Array.isArray(obj.notificationPrefs)) {
    for (const device of obj.notificationPrefs as unknown[]) {
      if (!device || typeof device !== 'object') continue;
      const rules = (device as { rules?: unknown }).rules;
      if (!Array.isArray(rules)) continue;
      for (const rule of rules) {
        const r = rule as { eventType?: unknown };
        if (typeof r.eventType !== 'string' || !(EVENT_TYPES as readonly string[]).includes(r.eventType)) {
          warnings.push(`Unknown event type "${String(r.eventType)}" will be skipped.`);
        }
      }
    }
  }

  return {
    ok: true,
    payload: { ...obj, zustandVersion, kind: EXPORT_FORMAT_KIND } as SettingsExportPayload,
    warnings,
  };
}

export function pickUiPrefsForCategories(
  uiPrefs: Partial<Record<UiPrefCategoryId, Record<string, unknown>>>,
  categories: UiPrefCategoryId[]
): Partial<Record<UiPrefCategoryId, Record<string, unknown>>> {
  const result: Partial<Record<UiPrefCategoryId, Record<string, unknown>>> = {};
  for (const id of categories) {
    if (uiPrefs[id]) result[id] = uiPrefs[id];
  }
  return result;
}
