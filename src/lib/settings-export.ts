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
import type { BandwidthSchedule } from '@/lib/bandwidth-scheduler/types';

// Allow-lists shared by import validation + the import route. Kept here so the
// client-side validator and the server-side applier agree on what's known.
export const ANIME_MAPPING_STATES = new Set<string>([
  'AUTO_MATCH', 'AUTO_UNMATCHED', 'MANUAL_MATCH', 'MANUAL_NONE',
]);
export const ANIME_MAPPING_ENTRY_SOURCES = new Set<string>(['auto', 'manual']);
export const USER_ROLE_VALUES = new Set<string>(['admin', 'member']);
export const USER_STATUS_VALUES = new Set<string>(['active', 'pending', 'disabled']);
export const USER_TEMPLATE_VALUES = new Set<string>(['admin', 'member']);

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
  | 'requests'
  | 'notificationFilters'
  | 'calendar'
  | 'cleanup'
  | 'dashboardTheme';

export const UI_PREF_CATEGORY_LABELS: Record<UiPrefCategoryId, string> = {
  navigation: 'Navigation',
  mediaViews: 'Movies, series & music views',
  discover: 'Discover',
  anime: 'Anime',
  torrents: 'Torrents',
  activity: 'Activity',
  requests: 'Requests (Seerr)',
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
    'moviesSortDirection', 'moviesFilter', 'moviesInstanceFilter', 'moviesWatchFilter', 'moviesVisibleFields',
    'seriesView', 'seriesPosterSize', 'seriesSort', 'seriesSearch',
    'seriesSortDirection', 'seriesFilter', 'seriesInstanceFilter', 'seriesWatchFilter', 'seriesVisibleFields',
    'musicView', 'musicPosterSize', 'musicSort', 'musicSearch',
    'musicSortDirection', 'musicFilter', 'musicVisibleFields',
  ],
  discover: ['discoverContentType', 'discoverSort', 'discoverSortDirection', 'discoverFilters'],
  anime: ['animeSort', 'animeFilters', 'animeCarouselOrder', 'disabledAnimeCarousels'],
  torrents: ['torrentsFilter', 'torrentsSortKey', 'torrentsSortDir'],
  activity: ['activityTab', 'activitySortBy', 'activityFilterBy'],
  requests: ['requestsTab', 'requestsFilter', 'requestsUserFilter', 'requestsTypeFilter', 'requestsSort', 'requestsSortDirection'],
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
  'RADARR', 'SONARR', 'LIDARR', 'QBITTORRENT', 'PROWLARR', 'JELLYFIN', 'TMDB', 'ANILIST', 'SEERR',
] as const;

export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  RADARR: 'Radarr',
  SONARR: 'Sonarr',
  LIDARR: 'Lidarr',
  QBITTORRENT: 'qBittorrent',
  PROWLARR: 'Prowlarr',
  JELLYFIN: 'Jellyfin',
  TMDB: 'TMDB',
  ANILIST: 'AniList',
  SEERR: 'Seerr',
};

export interface ExportedServiceConnection {
  type: ServiceType;
  label: string;
  isDefault: boolean;
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
  notificationHistoryRetentionDays: number;
  logClientConsoleEnabled: boolean;
  logFailedRequestBodies: boolean;
  logFailedResponseBodies: boolean;
  upcomingNotifyMode: string;
  upcomingNotifyBeforeMins: number;
  upcomingDailyNotifyHour: number;
  watchProviderRegion: string;
  activityDigestMode: string;
  activityDigestHour: number;
  activityDigestDayOfWeek: number;
  animeAutoMapEnabled: boolean;
  animeAutoMapHour: number;
  anilistSectionsTtlMin: number;
  anilistBrowseTtlMin: number;
  anilistDetailTtlMin: number;
  anilistAiringTtlMin: number;
  // Stored bandwidth-schedule JSON; re-normalized via parseBandwidthSchedule() on import.
  qbtBandwidthSchedule: BandwidthSchedule | null;
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

export interface ExportedAnimeMappingEntry {
  anilistMediaId: number;
  isPrimary: boolean;
  order: number;
  source: string;
  titleSnapshot: string | null;
}

export interface ExportedAnimeMapping {
  // ServiceConnection.label of the mapping's Sonarr instance (IDs are install-local).
  sonarrInstanceLabel: string;
  sonarrSeriesId: number;
  state: string;
  matchMethod: string | null;
  confidence: number | null;
  seriesTitleSnapshot: string;
  seriesYearSnapshot: number | null;
  seriesTvdbIdSnapshot: number | null;
  seriesTmdbIdSnapshot: number | null;
  entries: ExportedAnimeMappingEntry[];
}

export interface ExportedAnimeMappings {
  mappings: ExportedAnimeMapping[];
}

export interface ExportedUserSettings {
  timeZone: string | null;
  upcomingNotifyMode: string | null;
  activityDigestMode: string | null;
  quietHoursEnabled: boolean;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
}

export interface ExportedUserAniListIdentity {
  anilistUserId: number | null;
  username: string | null;
  avatar: string | null;
  siteUrl: string | null;
  scoreFormat: string | null;
}

export interface ExportedUserAccount {
  id: string;
  username: string;
  displayName: string;
  role: string;
  status: string;
  template: string;
  permissions: Record<string, unknown>; // capability deltas, validated via parsePermissions()
  jellyfinUserId: string | null;
  seerrUserId: string | null;
  // Only written when "Include API keys / tokens" is on (the scrypt hash).
  passwordHash?: string | null;
  settings: ExportedUserSettings | null;
  // Identity only — OAuth tokens are install-bound and deliberately excluded.
  anilist: ExportedUserAniListIdentity | null;
}

export interface ExportedUsers {
  accounts: ExportedUserAccount[];
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
  animeMappings?: ExportedAnimeMappings;
  users?: ExportedUsers;
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
      !Array.isArray((obj.watchlist as { items?: unknown }).items) ||
      !Array.isArray((obj.watchlist as { tags?: unknown }).tags))
  ) {
    return { ok: false, error: 'Invalid watchlist section.' };
  }
  if (
    obj.animeMappings !== undefined &&
    (typeof obj.animeMappings !== 'object' ||
      obj.animeMappings === null ||
      Array.isArray(obj.animeMappings) ||
      !Array.isArray((obj.animeMappings as { mappings?: unknown }).mappings))
  ) {
    return { ok: false, error: 'Invalid animeMappings section.' };
  }
  if (
    obj.users !== undefined &&
    (typeof obj.users !== 'object' ||
      obj.users === null ||
      Array.isArray(obj.users) ||
      !Array.isArray((obj.users as { accounts?: unknown }).accounts))
  ) {
    return { ok: false, error: 'Invalid users section.' };
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

  const animeMappings = obj.animeMappings as { mappings?: unknown } | undefined;
  if (animeMappings && Array.isArray(animeMappings.mappings)) {
    for (const m of animeMappings.mappings as unknown[]) {
      if (!m || typeof m !== 'object') continue;
      const state = (m as { state?: unknown }).state;
      if (typeof state !== 'string' || !ANIME_MAPPING_STATES.has(state)) {
        warnings.push(`Anime mapping with unknown state "${String(state)}" will be skipped.`);
      }
    }
  }

  const users = obj.users as { accounts?: unknown } | undefined;
  if (users && Array.isArray(users.accounts)) {
    for (const a of users.accounts as unknown[]) {
      if (!a || typeof a !== 'object') continue;
      const role = (a as { role?: unknown }).role;
      if (typeof role !== 'string' || !USER_ROLE_VALUES.has(role)) {
        warnings.push(`User with unknown role "${String(role)}" will be imported as a member.`);
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
