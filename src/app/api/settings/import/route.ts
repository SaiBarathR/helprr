import { NextRequest, NextResponse } from 'next/server';
import type { AppSettings, Prisma, ScheduledAlert, ServiceType, UserRole, UserStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAuth, requireCapability, getCurrentUser } from '@/lib/auth';
import { BOOTSTRAP_ADMIN_ID } from '@/lib/bootstrap-admin';
import { withApiLogging } from '@/lib/api-logger';
import { parseCustomHeaders } from '@/lib/service-connection-secrets';
import { pollingService } from '@/lib/polling-service';
import { setCachedCacheImagesEnabled } from '@/lib/cache/state';
import { disableCachingAndPurgeCaches } from '@/lib/cache/admin';
import { setAppTimeZone, isValidTimeZone, getEnvTimeZone } from '@/lib/timezone';
import { configureLogger } from '@/lib/logger';
import { configureApiLogging } from '@/lib/api-logger';
import { getOrCreateAppSettings } from '@/lib/app-settings';
import { EVENT_TYPES } from '@/lib/notification-events';
import { isServiceType } from '@/lib/service-connection-secrets';
import { isArrType, ensureDefaultForType, clearConnectionMemo } from '@/lib/arr-instances';
import { findServiceByType } from '@/lib/settings/service-config';
import { parseBandwidthSchedule } from '@/lib/bandwidth-scheduler/parse';
import { parseDiskThresholds } from '@/lib/disk-space';
import { parsePermissions } from '@/lib/permissions';
import { normalizeRegionCode } from '@/lib/region';
import { setCachedAnilistTtlSettings } from '@/lib/cache/state';
import {
  MAX_IMPORT_BYTES,
  ANIME_MAPPING_STATES,
  ANIME_MAPPING_ENTRY_SOURCES,
  USER_ROLE_VALUES,
  USER_STATUS_VALUES,
  USER_TEMPLATE_VALUES,
  type ExportedAppSettings,
  type ExportedAnimeMappings,
  type ExportedCleanup,
  type ExportedDashboardLayout,
  type ExportedDashboardLayouts,
  type ExportedScheduledAlerts,
  type ExportedServiceConnection,
  type ExportedNotificationDevice,
  type ExportedUsers,
  type ExportedWatchlist,
} from '@/lib/settings-export';
import { isAlertScope, isScheduleMode, parseReleaseTypes } from '@/lib/scheduled-alerts/helpers';
import { DEFAULT_OFFSET_MINUTES } from '@/lib/scheduled-alerts/constants';
import { createResolverContext, resolveAlertOccurrencesResult } from '@/lib/scheduled-alerts/resolver';
import { upsertOccurrencesForAlert } from '@/lib/scheduled-alerts/delivery';
import {
  validateDiscoverLayout,
  reconcileDiscoverLayout,
} from '@/lib/discover-layout-config';
import { restartDownloadCleaner, restartQueueCleaner } from '@/lib/cleanup/scheduler';
import { pruneStrikesForMissingRules } from '@/lib/cleanup/strikes';
import {
  MAX_LAYOUTS,
  MAX_NAME_LENGTH as MAX_LAYOUT_NAME_LENGTH,
  MAX_WIDGETS_PER_LAYOUT,
} from '@/lib/dashboard-layouts';
import { sanitizeDashboardLayout } from '@/lib/widgets/sanitize';
import { invalidateLayoutCache } from '@/lib/cache/dashboard-layout-cache';
import type { WidgetInstance } from '@/lib/widgets/types';
import {
  isValidMediaType,
  isValidSource,
  normalizeTagName,
  pickTagColor,
} from '@/lib/watchlist-helpers';

const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const UPCOMING_NOTIFY_MODES = new Set(['before_air', 'daily_digest']);
const ACTIVITY_DIGEST_MODES = new Set(['off', 'daily', 'weekly']);

// Watchlist field caps — match the regular POST /api/watchlist handler so an
// imported backup can't smuggle past validations the live UI enforces.
const WATCHLIST_MAX_TITLE_LEN = 200;
const WATCHLIST_MAX_POSTER_URL_LEN = 500;
const WATCHLIST_MAX_OVERVIEW_LEN = 2000;

function validateImportedPosterUrl(raw: string): string | null {
  if (raw.length > WATCHLIST_MAX_POSTER_URL_LEN) return null;
  if (!/^https?:\/\//i.test(raw)) return null;
  return raw;
}

interface ImportRequestBody {
  appSettings?: Partial<ExportedAppSettings>;
  serviceConnections?: ExportedServiceConnection[];
  notificationDevice?: ExportedNotificationDevice;
  cleanup?: ExportedCleanup;
  currentDeviceEndpoint?: string;
  discoverLayout?: Record<string, unknown>;
  dashboardLayouts?: ExportedDashboardLayouts;
  watchlist?: ExportedWatchlist;
  scheduledAlerts?: ExportedScheduledAlerts;
  animeMappings?: ExportedAnimeMappings;
  users?: ExportedUsers;
}

interface ImportResult {
  applied: {
    appSettings: boolean;
    services: ServiceType[];
    notificationRules: number;
    cleanup: boolean;
    dashboardLayouts: number;
    watchlistItems: number;
    watchlistTags: number;
    scheduledAlerts: number;
    animeMappings: number;
    users: number;
  };
  skipped: string[];
  pollingRestarted: boolean;
  discoverLayoutApplied: boolean;
}

/** Coerce to an integer, or null for null/undefined/non-integer values. */
function coerceIntOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

/** A nullable hour-of-day (0–23), or null when absent/out of range. */
function clampHourOrNull(value: unknown): number | null {
  const n = coerceIntOrNull(value);
  if (n === null || n < 0 || n > 23) return null;
  return n;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isInteger(value)
    ? value
    : typeof value === 'string' && /^\s*-?\d+\s*$/.test(value)
      ? parseInt(value, 10)
      : NaN;
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function pickEnum(value: unknown, allowed: Set<string>, fallback: string): string {
  return typeof value === 'string' && allowed.has(value) ? value : fallback;
}

function buildAppSettingsUpdate(
  input: Partial<ExportedAppSettings>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.pollingIntervalSecs !== undefined)
    out.pollingIntervalSecs = clampInt(input.pollingIntervalSecs, 1, 86_400, 30);
  if (input.activityRefreshIntervalSecs !== undefined)
    out.activityRefreshIntervalSecs = clampInt(input.activityRefreshIntervalSecs, 1, 86_400, 5);
  if (input.torrentsRefreshIntervalSecs !== undefined)
    out.torrentsRefreshIntervalSecs = clampInt(input.torrentsRefreshIntervalSecs, 1, 86_400, 5);
  if (input.cacheImagesEnabled !== undefined)
    out.cacheImagesEnabled = Boolean(input.cacheImagesEnabled);
  if (input.timeZone !== undefined) {
    const tz = typeof input.timeZone === 'string' && input.timeZone.trim().length > 0
      ? input.timeZone.trim()
      : getEnvTimeZone();
    out.timeZone = isValidTimeZone(tz) ? tz : getEnvTimeZone();
  }
  if (input.logEnabled !== undefined) out.logEnabled = Boolean(input.logEnabled);
  if (input.logLevel !== undefined) out.logLevel = pickEnum(input.logLevel, LOG_LEVELS, 'debug');
  if (input.logMaxFileMb !== undefined) out.logMaxFileMb = clampInt(input.logMaxFileMb, 1, 1024, 50);
  if (input.logRetentionDays !== undefined) out.logRetentionDays = clampInt(input.logRetentionDays, 1, 3650, 30);
  if (input.notificationHistoryRetentionDays !== undefined)
    out.notificationHistoryRetentionDays = clampInt(input.notificationHistoryRetentionDays, 1, 3650, 90);
  if (input.logClientConsoleEnabled !== undefined)
    out.logClientConsoleEnabled = Boolean(input.logClientConsoleEnabled);
  if (input.logFailedRequestBodies !== undefined)
    out.logFailedRequestBodies = Boolean(input.logFailedRequestBodies);
  if (input.logFailedResponseBodies !== undefined)
    out.logFailedResponseBodies = Boolean(input.logFailedResponseBodies);
  // `upcomingAlertHours` was removed; older exports may still carry it.
  // Silently drop it — there is no corresponding column to write to.
  if (input.upcomingNotifyMode !== undefined)
    out.upcomingNotifyMode = pickEnum(input.upcomingNotifyMode, UPCOMING_NOTIFY_MODES, 'before_air');
  if (input.upcomingNotifyBeforeMins !== undefined)
    out.upcomingNotifyBeforeMins = clampInt(input.upcomingNotifyBeforeMins, 0, 10_080, 60);
  if (input.upcomingDailyNotifyHour !== undefined)
    out.upcomingDailyNotifyHour = clampInt(input.upcomingDailyNotifyHour, 0, 23, 9);
  if (input.watchProviderRegion !== undefined)
    out.watchProviderRegion = normalizeRegionCode(input.watchProviderRegion) ?? 'US';
  if (input.activityDigestMode !== undefined)
    out.activityDigestMode = pickEnum(input.activityDigestMode, ACTIVITY_DIGEST_MODES, 'off');
  if (input.activityDigestHour !== undefined)
    out.activityDigestHour = clampInt(input.activityDigestHour, 0, 23, 8);
  if (input.activityDigestDayOfWeek !== undefined)
    out.activityDigestDayOfWeek = clampInt(input.activityDigestDayOfWeek, 0, 6, 1);
  if (input.notificationGroupingEnabled !== undefined)
    out.notificationGroupingEnabled = Boolean(input.notificationGroupingEnabled);
  if (input.animeAutoMapEnabled !== undefined)
    out.animeAutoMapEnabled = Boolean(input.animeAutoMapEnabled);
  if (input.animeAutoMapHour !== undefined)
    out.animeAutoMapHour = clampInt(input.animeAutoMapHour, 0, 23, 0);
  // AniList cache TTLs in minutes (max 30 days), mirroring PATCH /api/settings.
  if (input.anilistSectionsTtlMin !== undefined)
    out.anilistSectionsTtlMin = clampInt(input.anilistSectionsTtlMin, 1, 43_200, 5);
  if (input.anilistBrowseTtlMin !== undefined)
    out.anilistBrowseTtlMin = clampInt(input.anilistBrowseTtlMin, 1, 43_200, 10);
  if (input.anilistDetailTtlMin !== undefined)
    out.anilistDetailTtlMin = clampInt(input.anilistDetailTtlMin, 1, 43_200, 1440);
  if (input.anilistAiringTtlMin !== undefined)
    out.anilistAiringTtlMin = clampInt(input.anilistAiringTtlMin, 1, 43_200, 10);
  if (input.qbtBandwidthSchedule !== undefined)
    out.qbtBandwidthSchedule =
      parseBandwidthSchedule(input.qbtBandwidthSchedule) as unknown as Prisma.InputJsonValue;
  if (input.diskThresholds !== undefined)
    out.diskThresholds = parseDiskThresholds(input.diskThresholds) as unknown as Prisma.InputJsonValue;
  return out;
}

interface AppSettingsTxnResult {
  appliedKeys: string[];
  wasCachingEnabled: boolean;
  pollingIntervalSecsChanged: number | null;
  settings: AppSettings;
}

async function applyAppSettingsInTxn(
  tx: Prisma.TransactionClient,
  input: Partial<ExportedAppSettings>
): Promise<AppSettingsTxnResult | null> {
  const data = buildAppSettingsUpdate(input);
  if (Object.keys(data).length === 0) return null;

  const current = await tx.appSettings.findUnique({ where: { id: 'singleton' } });
  const wasCachingEnabled = current?.cacheImagesEnabled ?? true;

  const settings = await tx.appSettings.upsert({
    where: { id: 'singleton' },
    update: data,
    create: {
      id: 'singleton',
      pollingIntervalSecs: (data.pollingIntervalSecs as number | undefined) ?? 30,
      activityRefreshIntervalSecs: (data.activityRefreshIntervalSecs as number | undefined) ?? 5,
      torrentsRefreshIntervalSecs: (data.torrentsRefreshIntervalSecs as number | undefined) ?? 5,
      cacheImagesEnabled: (data.cacheImagesEnabled as boolean | undefined) ?? true,
      timeZone: (data.timeZone as string | undefined) ?? getEnvTimeZone(),
      logEnabled: (data.logEnabled as boolean | undefined) ?? true,
      logLevel: (data.logLevel as string | undefined) ?? 'debug',
      logMaxFileMb: (data.logMaxFileMb as number | undefined) ?? 50,
      logRetentionDays: (data.logRetentionDays as number | undefined) ?? 30,
      notificationHistoryRetentionDays:
        (data.notificationHistoryRetentionDays as number | undefined) ?? 90,
      logClientConsoleEnabled: (data.logClientConsoleEnabled as boolean | undefined) ?? true,
      logFailedRequestBodies: (data.logFailedRequestBodies as boolean | undefined) ?? false,
      logFailedResponseBodies: (data.logFailedResponseBodies as boolean | undefined) ?? false,
      upcomingNotifyMode: (data.upcomingNotifyMode as string | undefined) ?? 'before_air',
      upcomingNotifyBeforeMins: (data.upcomingNotifyBeforeMins as number | undefined) ?? 60,
      upcomingDailyNotifyHour: (data.upcomingDailyNotifyHour as number | undefined) ?? 9,
      watchProviderRegion: (data.watchProviderRegion as string | undefined) ?? 'US',
      activityDigestMode: (data.activityDigestMode as string | undefined) ?? 'off',
      activityDigestHour: (data.activityDigestHour as number | undefined) ?? 8,
      activityDigestDayOfWeek: (data.activityDigestDayOfWeek as number | undefined) ?? 1,
      notificationGroupingEnabled: (data.notificationGroupingEnabled as boolean | undefined) ?? true,
      animeAutoMapEnabled: (data.animeAutoMapEnabled as boolean | undefined) ?? true,
      animeAutoMapHour: (data.animeAutoMapHour as number | undefined) ?? 0,
      anilistSectionsTtlMin: (data.anilistSectionsTtlMin as number | undefined) ?? 5,
      anilistBrowseTtlMin: (data.anilistBrowseTtlMin as number | undefined) ?? 10,
      anilistDetailTtlMin: (data.anilistDetailTtlMin as number | undefined) ?? 1440,
      anilistAiringTtlMin: (data.anilistAiringTtlMin as number | undefined) ?? 10,
      ...(data.qbtBandwidthSchedule !== undefined
        ? { qbtBandwidthSchedule: data.qbtBandwidthSchedule as Prisma.InputJsonValue }
        : {}),
      ...(data.diskThresholds !== undefined
        ? { diskThresholds: data.diskThresholds as Prisma.InputJsonValue }
        : {}),
    },
  });

  return {
    appliedKeys: Object.keys(data),
    wasCachingEnabled,
    pollingIntervalSecsChanged:
      data.pollingIntervalSecs !== undefined ? (data.pollingIntervalSecs as number) : null,
    settings,
  };
}

async function applyServiceConnectionInTxn(
  tx: Prisma.TransactionClient,
  conn: ExportedServiceConnection,
  skipped: string[]
): Promise<ServiceType | null> {
  if (typeof conn.type !== 'string' || !isServiceType(conn.type)) {
    skipped.push(`Skipped service: invalid type "${String(conn.type)}"`);
    return null;
  }
  if (typeof conn.url !== 'string' || conn.url.trim().length === 0) {
    skipped.push(`Skipped ${conn.type}: missing URL`);
    return null;
  }
  const url = conn.url.trim().replace(/\/+$/, '');
  const externalUrl = typeof conn.externalUrl === 'string' && conn.externalUrl.trim().length > 0
    ? conn.externalUrl.trim().replace(/\/+$/, '')
    : null;
  const username = typeof conn.username === 'string' && conn.username.length > 0
    ? conn.username
    : conn.type === 'QBITTORRENT' ? 'admin' : null;

  // Multi-instance: arr connections are identified by (type, label); other types
  // are the single connection of their type. Older (pre-multi-instance) exports
  // carry no label — arr connections fall back to the type name (the same value
  // manual-fixups backfills existing rows to), so a legacy single-instance backup
  // restores onto (and idempotently updates) the migrated connection instead of
  // being skipped or duplicated. Single-instance types match by type alone, so
  // their label is cosmetic.
  const isArr = isArrType(conn.type);
  const rawLabel = typeof conn.label === 'string' ? conn.label.trim() : '';
  const label = isArr
    ? (rawLabel || conn.type)
    : (rawLabel || findServiceByType(conn.type)?.label || conn.type);

  const existing = isArr
    ? await tx.serviceConnection.findFirst({ where: { type: conn.type, label } })
    : await tx.serviceConnection.findFirst({ where: { type: conn.type } });
  const apiKey = typeof conn.apiKey === 'string' && conn.apiKey.length > 0
    ? conn.apiKey
    : existing?.apiKey ?? null;

  if (!apiKey) {
    skipped.push(`Skipped ${conn.type}: no API key in file and no existing connection`);
    return null;
  }

  const accessToken = typeof conn.accessToken === 'string' && conn.accessToken.length > 0
    ? conn.accessToken
    : existing?.accessToken ?? null;
  const refreshToken = typeof conn.refreshToken === 'string' && conn.refreshToken.length > 0
    ? conn.refreshToken
    : existing?.refreshToken ?? null;
  // Present with at least one valid header → restore; absent, empty, or
  // all-invalid → leave any existing headers untouched (a hand-edited or empty
  // map must not silently wipe stored proxy headers). A normal export writes
  // null when there are none, so legit round-trips are unaffected. Not gated by
  // HELPRR_CUSTOM_HEADERS: restoring data is independent of whether sending is on.
  const parsedHeaders = conn.customHeaders != null ? parseCustomHeaders(conn.customHeaders) : null;
  const customHeaders = parsedHeaders && Object.keys(parsedHeaders).length > 0 ? parsedHeaders : null;

  if (existing) {
    await tx.serviceConnection.update({
      where: { id: existing.id },
      data: {
        url, apiKey, username, label, externalUrl,
        ...(accessToken !== null && { accessToken }),
        ...(refreshToken !== null && { refreshToken }),
        ...(customHeaders !== null && { customHeaders }),
      },
    });
  } else {
    // A label-less arr export (a pre-multi-instance backup) restored into a DB that
    // already has instances of this type can't be matched to a specific instance, so
    // it lands as a new one labeled by type. Warn so the operator can spot a possible
    // duplicate of an existing instance instead of it being created silently.
    if (isArr && rawLabel === '') {
      const sameTypeCount = await tx.serviceConnection.count({ where: { type: conn.type } });
      if (sameTypeCount > 0) {
        skipped.push(`Imported ${conn.type} as a new instance "${label}" (backup predates instance labels) — verify it isn't a duplicate of an existing ${conn.type} instance.`);
      }
    }
    await tx.serviceConnection.create({
      data: {
        type: conn.type, label, isDefault: conn.isDefault === true, url, apiKey, username, externalUrl,
        ...(accessToken !== null && { accessToken }),
        ...(refreshToken !== null && { refreshToken }),
        ...(customHeaders !== null && { customHeaders }),
      },
    });
  }
  return conn.type;
}

async function applyNotificationDeviceInTxn(
  tx: Prisma.TransactionClient,
  device: ExportedNotificationDevice,
  currentDeviceEndpoint: string | undefined,
  skipped: string[]
): Promise<number> {
  if (!currentDeviceEndpoint) {
    skipped.push('Notification prefs: no active push subscription on this device');
    return 0;
  }
  const subscription = await tx.pushSubscription.findUnique({
    where: { endpoint: currentDeviceEndpoint },
    select: { id: true },
  });
  if (!subscription) {
    skipped.push('Notification prefs: current device push subscription not found');
    return 0;
  }
  let applied = 0;
  for (const rule of device.rules ?? []) {
    if (typeof rule.eventType !== 'string' || !(EVENT_TYPES as readonly string[]).includes(rule.eventType)) {
      continue;
    }
    await tx.notificationPreference.upsert({
      where: {
        subscriptionId_eventType: {
          subscriptionId: subscription.id,
          eventType: rule.eventType,
        },
      },
      update: {
        enabled: Boolean(rule.enabled),
        tagFilter: rule.tagFilter ?? null,
        qualityFilter: rule.qualityFilter ?? null,
        mutedUserFilter: rule.mutedUserFilter ?? null,
      },
      create: {
        subscriptionId: subscription.id,
        eventType: rule.eventType,
        enabled: Boolean(rule.enabled),
        tagFilter: rule.tagFilter ?? null,
        qualityFilter: rule.qualityFilter ?? null,
        mutedUserFilter: rule.mutedUserFilter ?? null,
      },
    });
    applied += 1;
  }
  return applied;
}

async function applyCleanupInTxn(
  tx: Prisma.TransactionClient,
  data: ExportedCleanup,
  skipped: string[],
): Promise<void> {
  // Configs are singletons — upsert in place.
  if (data.queueConfig && typeof data.queueConfig === 'object') {
    const c = data.queueConfig;
    await tx.queueCleanerConfig.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        enabled: Boolean(c.enabled),
        intervalMinutes: Math.max(1, Number(c.intervalMinutes) || 60),
        ignoredDownloads: Array.isArray(c.ignoredDownloads) ? c.ignoredDownloads : [],
        processNoContentId: Boolean(c.processNoContentId),
        downloadingMetadataMaxStrikes: Math.max(0, Number(c.downloadingMetadataMaxStrikes) || 0),
        failedImport: (c.failedImport ?? {}) as unknown as Prisma.InputJsonValue,
        reSearchAfterRemoval: Boolean(c.reSearchAfterRemoval),
        autoRunMode: typeof c.autoRunMode === 'string' ? c.autoRunMode : 'disabled',
      },
      update: {
        enabled: Boolean(c.enabled),
        intervalMinutes: Math.max(1, Number(c.intervalMinutes) || 60),
        ignoredDownloads: Array.isArray(c.ignoredDownloads) ? c.ignoredDownloads : [],
        processNoContentId: Boolean(c.processNoContentId),
        downloadingMetadataMaxStrikes: Math.max(0, Number(c.downloadingMetadataMaxStrikes) || 0),
        failedImport: (c.failedImport ?? {}) as unknown as Prisma.InputJsonValue,
        reSearchAfterRemoval: Boolean(c.reSearchAfterRemoval),
        autoRunMode: typeof c.autoRunMode === 'string' ? c.autoRunMode : 'disabled',
      },
    });
  } else {
    skipped.push('Cleanup: queueConfig missing or invalid');
  }

  if (data.downloadConfig && typeof data.downloadConfig === 'object') {
    const c = data.downloadConfig;
    const importedPrivacy = typeof c.autoRemoveImportedPrivacyType === 'string'
      && ['public', 'private', 'both'].includes(c.autoRemoveImportedPrivacyType)
      ? c.autoRemoveImportedPrivacyType
      : 'public';
    await tx.downloadCleanerConfig.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        enabled: Boolean(c.enabled),
        intervalMinutes: Math.max(1, Number(c.intervalMinutes) || 60),
        ignoredDownloads: Array.isArray(c.ignoredDownloads) ? c.ignoredDownloads : [],
        autoRemoveImportedEnabled: Boolean(c.autoRemoveImportedEnabled),
        autoRemoveImportedCategories: Array.isArray(c.autoRemoveImportedCategories) ? c.autoRemoveImportedCategories : [],
        autoRemoveImportedDeleteFiles: Boolean(c.autoRemoveImportedDeleteFiles),
        autoRemoveImportedPrivacyType: importedPrivacy,
        autoRunMode: typeof c.autoRunMode === 'string' ? c.autoRunMode : 'disabled',
      },
      update: {
        enabled: Boolean(c.enabled),
        intervalMinutes: Math.max(1, Number(c.intervalMinutes) || 60),
        ignoredDownloads: Array.isArray(c.ignoredDownloads) ? c.ignoredDownloads : [],
        autoRemoveImportedEnabled: Boolean(c.autoRemoveImportedEnabled),
        autoRemoveImportedCategories: Array.isArray(c.autoRemoveImportedCategories) ? c.autoRemoveImportedCategories : [],
        autoRemoveImportedDeleteFiles: Boolean(c.autoRemoveImportedDeleteFiles),
        autoRemoveImportedPrivacyType: importedPrivacy,
        autoRunMode: typeof c.autoRunMode === 'string' ? c.autoRunMode : 'disabled',
      },
    });
  } else {
    skipped.push('Cleanup: downloadConfig missing or invalid');
  }

  // Replace user-defined rules with the imported set. System rules (the
  // synthetic auto-remove-imported seeding rule) are preserved — they're
  // managed by saveDownloadCleanerConfig and will be re-synced on next save.
  // Only delete when a NON-EMPTY replacement array is supplied: a missing or
  // malformed key — or an explicitly empty array (`[]`, which Array.isArray
  // also accepts) — must not silently wipe existing rules. Export always emits
  // full arrays, so legitimate backups still replace correctly; this only
  // closes the "clear-all-via-empty-array" footgun for hand-edited JSON.
  if (Array.isArray(data.stallRules) && data.stallRules.length > 0) {
    await tx.stallRule.deleteMany({});
    for (const r of data.stallRules) {
      if (!r || typeof r !== 'object') continue;
      await tx.stallRule.create({
        data: {
          name: String(r.name ?? 'Stall rule'),
          enabled: Boolean(r.enabled),
          priority: Number(r.priority) || 0,
          maxStrikes: Math.max(3, Number(r.maxStrikes) || 3),
          privacyType: String(r.privacyType ?? 'public'),
          minCompletionPercentage: Math.max(0, Math.min(100, Number(r.minCompletionPercentage) || 0)),
          maxCompletionPercentage: Math.max(1, Math.min(100, Number(r.maxCompletionPercentage) || 100)),
          resetStrikesOnProgress: Boolean(r.resetStrikesOnProgress),
          minimumProgressBytes:
            r.minimumProgressBytes != null && Number.isFinite(Number(r.minimumProgressBytes))
              ? BigInt(Math.max(0, Math.floor(Number(r.minimumProgressBytes))))
              : null,
          changeCategory: Boolean(r.changeCategory),
          deletePrivate: Boolean(r.deletePrivate),
          reSearchOverride: r.reSearchOverride === null || r.reSearchOverride === undefined ? null : Boolean(r.reSearchOverride),
        },
      });
    }
  }

  if (Array.isArray(data.slowRules) && data.slowRules.length > 0) {
    await tx.slowRule.deleteMany({});
    for (const r of data.slowRules) {
      if (!r || typeof r !== 'object') continue;
      await tx.slowRule.create({
        data: {
          name: String(r.name ?? 'Slow rule'),
          enabled: Boolean(r.enabled),
          priority: Number(r.priority) || 0,
          maxStrikes: Math.max(3, Number(r.maxStrikes) || 3),
          privacyType: String(r.privacyType ?? 'public'),
          minCompletionPercentage: Math.max(0, Math.min(100, Number(r.minCompletionPercentage) || 0)),
          maxCompletionPercentage: Math.max(1, Math.min(100, Number(r.maxCompletionPercentage) || 100)),
          minSpeedKbps: r.minSpeedKbps != null ? Math.max(0, Number(r.minSpeedKbps) || 0) : null,
          maxTimeHours: r.maxTimeHours != null ? Math.max(0, Number(r.maxTimeHours) || 0) : null,
          ignoreAboveSizeBytes:
            r.ignoreAboveSizeBytes != null && Number.isFinite(Number(r.ignoreAboveSizeBytes))
              ? BigInt(Math.max(0, Math.floor(Number(r.ignoreAboveSizeBytes))))
              : null,
          resetStrikesOnProgress: Boolean(r.resetStrikesOnProgress),
          changeCategory: Boolean(r.changeCategory),
          deletePrivate: Boolean(r.deletePrivate),
          reSearchOverride: r.reSearchOverride === null || r.reSearchOverride === undefined ? null : Boolean(r.reSearchOverride),
        },
      });
    }
  }

  if (Array.isArray(data.seedingRules) && data.seedingRules.length > 0) {
    await tx.seedingRule.deleteMany({ where: { isSystem: false } });
    let restoredRuleLevelConfirmation = false;
    for (const r of data.seedingRules) {
      if (!r || typeof r !== 'object') continue;
      const requireImportedConfirmation = Boolean(r.requireImportedConfirmation);
      const enabled = Boolean(r.enabled);
      if (enabled && requireImportedConfirmation) restoredRuleLevelConfirmation = true;
      await tx.seedingRule.create({
        data: {
          name: String(r.name ?? 'Seeding rule'),
          enabled,
          // Clamp restored priority to >= 0 — the system row's -1000 is
          // reserved and a backup from a buggy build could otherwise land an
          // unconstrained negative.
          priority: Math.max(0, Number(r.priority) || 0),
          categories: Array.isArray(r.categories) ? r.categories : [],
          trackerPatterns: Array.isArray(r.trackerPatterns) ? r.trackerPatterns : [],
          tagsAny: Array.isArray(r.tagsAny) ? r.tagsAny : [],
          tagsAll: Array.isArray(r.tagsAll) ? r.tagsAll : [],
          privacyType: String(r.privacyType ?? 'both'),
          maxRatio: Number.isFinite(Number(r.maxRatio)) ? Number(r.maxRatio) : 1,
          minSeedTimeHours: Math.max(0, Number(r.minSeedTimeHours) || 0),
          maxSeedTimeHours: Number.isFinite(Number(r.maxSeedTimeHours)) ? Number(r.maxSeedTimeHours) : -1,
          deleteSourceFiles: Boolean(r.deleteSourceFiles),
          requireImportedConfirmation,
          isSystem: false,
        },
      });
    }
    // Enforce mutual exclusion after the rules transaction. If a restored
    // backup contains both the global toggle on AND any rule-level rule, the
    // global wins of the global toggle is the more conservative state; flip it
    // off and let the rule-level rules be the active mechanism.
    if (restoredRuleLevelConfirmation) {
      // upsert (not update) because the backup may not have included
      // downloadConfig, in which case the singleton row may not exist yet.
      await tx.downloadCleanerConfig.upsert({
        where: { id: 'singleton' },
        create: { id: 'singleton', autoRemoveImportedEnabled: false },
        update: { autoRemoveImportedEnabled: false },
      });
    }
  }
}

function validateLayoutWidgets(widgets: unknown): WidgetInstance[] | null {
  if (!Array.isArray(widgets)) return null;
  if (widgets.length > MAX_WIDGETS_PER_LAYOUT) return null;
  for (const w of widgets) {
    if (!w || typeof w !== 'object') return null;
    const item = w as Record<string, unknown>;
    if (typeof item.id !== 'string' || typeof item.widgetId !== 'string') return null;
  }
  return widgets as WidgetInstance[];
}

async function applyDashboardLayoutsInTxn(
  tx: Prisma.TransactionClient,
  data: ExportedDashboardLayouts,
  skipped: string[],
): Promise<number> {
  if (!Array.isArray(data.layouts)) {
    skipped.push('Dashboard layouts: missing layouts array');
    return 0;
  }

  // Read the current discoverLayout once so widget sanitization can resolve
  // dynamic `discover-*` widgets.
  const settingsRow = await tx.appSettings.findUnique({
    where: { id: 'singleton' },
    select: { discoverLayout: true },
  });
  const rawDiscover = settingsRow?.discoverLayout as unknown;
  const validatedDiscover = rawDiscover ? validateDiscoverLayout(rawDiscover) : null;
  const discoverLayout = reconcileDiscoverLayout(validatedDiscover);

  // Stage 1: upsert built-ins by slug (preserve existing IDs so anything
  // referencing them keeps working).
  // Stage 2: upsert user layouts by unique name.
  // We don't delete existing user layouts that aren't in the import — that's
  // less destructive and matches how appSettings/serviceConnections behave.
  const builtIns = data.layouts.filter(
    (l) => l && (l.slug === 'desktop' || l.slug === 'mobile'),
  );
  const userLayouts = data.layouts.filter(
    (l) => l && !(l.slug === 'desktop' || l.slug === 'mobile'),
  );

  let applied = 0;

  for (const layout of builtIns) {
    const widgets = validateLayoutWidgets(layout.widgets);
    if (!widgets) {
      skipped.push(`Dashboard layout "${String(layout.name ?? layout.slug)}" skipped: invalid widgets`);
      continue;
    }
    const sanitized = sanitizeDashboardLayout(widgets, discoverLayout);
    const name = typeof layout.name === 'string' && layout.name.trim().length > 0
      ? layout.name.trim().slice(0, MAX_LAYOUT_NAME_LENGTH)
      : layout.slug === 'mobile' ? 'Mobile' : 'Desktop';
    const slug = layout.slug as 'desktop' | 'mobile';

    const existing = await tx.dashboardLayout.findUnique({ where: { slug } });
    if (existing) {
      // Update widgets; rename only if the new name is free (otherwise keep
      // the existing name to avoid a unique-constraint violation).
      const nameTaken = name !== existing.name
        ? await tx.dashboardLayout.findFirst({ where: { name, userId: null }, select: { id: true } })
        : null;
      await tx.dashboardLayout.update({
        where: { id: existing.id },
        data: {
          widgets: sanitized as unknown as Prisma.InputJsonValue,
          isBuiltIn: true,
          ...(nameTaken ? {} : { name }),
        },
      });
    } else {
      // No row with this slug yet — create one. If the desired name collides
      // with a user layout, fall back to the canonical name. Walk a counter
      // suffix until we land on something the unique(name) constraint will
      // accept, so a second import never blows up.
      let finalName = name;
      const nameTaken = await tx.dashboardLayout.findFirst({ where: { name, userId: null }, select: { id: true } });
      if (nameTaken) {
        const base = slug === 'mobile' ? 'Mobile (built-in)' : 'Desktop (built-in)';
        finalName = base;
        let suffix = 2;
        while (await tx.dashboardLayout.findFirst({ where: { name: finalName, userId: null }, select: { id: true } })) {
          finalName = `${base} ${suffix}`;
          suffix += 1;
        }
      }
      await tx.dashboardLayout.create({
        data: {
          name: finalName,
          slug,
          isBuiltIn: true,
          widgets: sanitized as unknown as Prisma.InputJsonValue,
        },
      });
    }
    applied += 1;
  }

  // Cap user-layout imports so we never blow past MAX_LAYOUTS.
  const builtInCount = await tx.dashboardLayout.count({ where: { isBuiltIn: true, userId: null } });
  const userCountBefore = await tx.dashboardLayout.count({ where: { isBuiltIn: false, userId: null } });
  const remainingSlots = Math.max(0, MAX_LAYOUTS - builtInCount - userCountBefore);

  let createdUser = 0;
  for (const layout of userLayouts) {
    if (typeof layout.name !== 'string' || layout.name.trim().length === 0) {
      skipped.push('Dashboard layout skipped: missing name');
      continue;
    }
    const name = layout.name.trim().slice(0, MAX_LAYOUT_NAME_LENGTH);
    const widgets = validateLayoutWidgets(layout.widgets);
    if (!widgets) {
      skipped.push(`Dashboard layout "${name}" skipped: invalid widgets`);
      continue;
    }
    const sanitized = sanitizeDashboardLayout(widgets, discoverLayout);
    const existing = await tx.dashboardLayout.findFirst({ where: { name, userId: null } });
    if (existing) {
      // Don't downgrade an existing built-in to a user layout — skip and warn.
      if (existing.isBuiltIn) {
        skipped.push(`Dashboard layout "${name}" skipped: collides with a built-in name`);
        continue;
      }
      await tx.dashboardLayout.update({
        where: { id: existing.id },
        data: { widgets: sanitized as unknown as Prisma.InputJsonValue },
      });
      applied += 1;
    } else {
      if (createdUser >= remainingSlots) {
        skipped.push(`Dashboard layout "${name}" skipped: max ${MAX_LAYOUTS} layouts reached`);
        continue;
      }
      await tx.dashboardLayout.create({
        data: {
          name,
          isBuiltIn: false,
          slug: null,
          widgets: sanitized as unknown as Prisma.InputJsonValue,
        },
      });
      applied += 1;
      createdUser += 1;
    }
  }

  // Resolve default-layout names back to IDs and persist on AppSettings.
  // Prefer slug lookup for built-ins so a user layout that happens to share
  // the built-in's name can't beat the actual built-in.
  const desktopName = typeof data.defaultDesktopLayoutName === 'string'
    ? data.defaultDesktopLayoutName.trim()
    : null;
  const mobileName = typeof data.defaultMobileLayoutName === 'string'
    ? data.defaultMobileLayoutName.trim()
    : null;
  const desktopBuiltIn = await tx.dashboardLayout.findUnique({ where: { slug: 'desktop' }, select: { id: true, name: true } });
  const mobileBuiltIn = await tx.dashboardLayout.findUnique({ where: { slug: 'mobile' }, select: { id: true, name: true } });
  // Match built-ins by slug FIRST (case-insensitive). If the imported name is
  // "Desktop"/"Mobile" — the canonical built-in name — and the local built-in
  // happens to have been renamed (or had its name suffixed away by the
  // collision logic above when a user layout already owned "Desktop"), the
  // name-only lookup would otherwise resolve to the user layout. That made
  // the wrong row get persisted as the default.
  const desktopRow = desktopName
    ? (desktopBuiltIn && (
          desktopName.toLowerCase() === 'desktop' ||
          desktopBuiltIn.name === desktopName
        )
        ? desktopBuiltIn
        : await tx.dashboardLayout.findFirst({ where: { name: desktopName, userId: null }, select: { id: true } }))
    : null;
  const mobileRow = mobileName
    ? (mobileBuiltIn && (
          mobileName.toLowerCase() === 'mobile' ||
          mobileBuiltIn.name === mobileName
        )
        ? mobileBuiltIn
        : await tx.dashboardLayout.findFirst({ where: { name: mobileName, userId: null }, select: { id: true } }))
    : null;
  if (desktopRow || mobileRow) {
    await tx.appSettings.upsert({
      where: { id: 'singleton' },
      update: {
        ...(desktopRow ? { defaultDesktopLayoutId: desktopRow.id } : {}),
        ...(mobileRow ? { defaultMobileLayoutId: mobileRow.id } : {}),
      },
      create: {
        id: 'singleton',
        defaultDesktopLayoutId: desktopRow?.id ?? null,
        defaultMobileLayoutId: mobileRow?.id ?? null,
      },
    });
  }
  if (desktopName && !desktopRow) {
    skipped.push(`Default desktop layout "${desktopName}" not found in import — left unchanged`);
  }
  if (mobileName && !mobileRow) {
    skipped.push(`Default mobile layout "${mobileName}" not found in import — left unchanged`);
  }

  return applied;
}

interface WatchlistApplyResult {
  items: number;
  tags: number;
}

async function applyWatchlistInTxn(
  tx: Prisma.TransactionClient,
  data: ExportedWatchlist,
  skipped: string[],
  ownerUserId: string,
): Promise<WatchlistApplyResult> {
  if (!Array.isArray(data.items)) {
    skipped.push('Watchlist: missing items array');
    return { items: 0, tags: 0 };
  }

  // Upsert tags first so item.tags connect lookups always resolve.
  const incomingTags: { name: string; color: string | null }[] = [];
  if (Array.isArray(data.tags)) {
    for (const t of data.tags) {
      if (!t || typeof t !== 'object' || typeof t.name !== 'string') continue;
      const name = normalizeTagName(t.name);
      if (!name || name.length > 50) continue;
      const color = typeof t.color === 'string' && t.color.length > 0 ? t.color : null;
      incomingTags.push({ name, color });
    }
  }

  // Collect tag names from items so we create any tag the user references
  // even if the export omitted a tag row (or sent items but no tags array).
  const itemTagNames = new Set<string>();
  for (const it of data.items) {
    if (!it || typeof it !== 'object' || !Array.isArray(it.tags)) continue;
    for (const t of it.tags) {
      if (typeof t !== 'string') continue;
      const n = normalizeTagName(t);
      if (n && n.length <= 50) itemTagNames.add(n);
    }
  }

  const allTagNames = new Set(incomingTags.map((t) => t.name));
  for (const n of itemTagNames) allTagNames.add(n);

  // Batch: fetch what already exists, bulk-create the rest, then re-read so
  // we have ids for every name. Same pattern as ensureTagIds() — avoids one
  // round-trip per tag inside the transaction. We intentionally don't update
  // colors of pre-existing tags on import; users tend to recolor in-app and
  // wouldn't expect an import to clobber that.
  const incomingColorByName = new Map(incomingTags.map((t) => [t.name, t.color]));
  const tagIdByName = new Map<string, string>();
  let tagCount = 0;
  if (allTagNames.size > 0) {
    const names = Array.from(allTagNames);
    const existing = await tx.watchlistTag.findMany({
      where: { userId: ownerUserId, name: { in: names } },
      select: { id: true, name: true },
    });
    for (const row of existing) tagIdByName.set(row.name, row.id);
    tagCount = existing.length;

    const toCreate = names.filter((n) => !tagIdByName.has(n));
    if (toCreate.length > 0) {
      await tx.watchlistTag.createMany({
        data: toCreate.map((name) => ({
          userId: ownerUserId,
          name,
          color: incomingColorByName.get(name) ?? pickTagColor(name),
        })),
        skipDuplicates: true,
      });
      const fresh = await tx.watchlistTag.findMany({
        where: { userId: ownerUserId, name: { in: toCreate } },
        select: { id: true, name: true },
      });
      for (const row of fresh) tagIdByName.set(row.name, row.id);
      tagCount += fresh.length;
    }
  }

  let itemCount = 0;
  for (const it of data.items) {
    if (!it || typeof it !== 'object') continue;
    const sourceRaw = typeof it.source === 'string' ? it.source.toUpperCase() : '';
    const mediaType = typeof it.mediaType === 'string' ? it.mediaType.toLowerCase() : '';
    const externalId = typeof it.externalId === 'string' ? it.externalId
      : typeof it.externalId === 'number' ? String(it.externalId) : '';
    const titleRaw = typeof it.title === 'string' ? it.title.trim() : '';
    if (!isValidSource(sourceRaw) || !isValidMediaType(mediaType) || !externalId || !titleRaw) {
      skipped.push(`Watchlist item "${titleRaw || externalId}" skipped: invalid identifying fields`);
      continue;
    }
    const title = titleRaw.slice(0, WATCHLIST_MAX_TITLE_LEN);

    const year = typeof it.year === 'number' && Number.isFinite(it.year) ? it.year : null;
    let posterUrl: string | null = null;
    if (typeof it.posterUrl === 'string' && it.posterUrl.length > 0) {
      posterUrl = validateImportedPosterUrl(it.posterUrl);
      if (posterUrl === null) {
        skipped.push(`Watchlist item "${title}": posterUrl dropped (invalid scheme or too long)`);
      }
    }
    const overview = typeof it.overview === 'string'
      ? it.overview.slice(0, WATCHLIST_MAX_OVERVIEW_LEN)
      : null;
    const rating = typeof it.rating === 'number' && Number.isFinite(it.rating)
      ? Math.max(0, Math.min(100, it.rating))
      : null;
    // Drop reminders whose timestamp is already in the past so importing a
    // stale backup doesn't fire a push on the very next poll cycle.
    const reminderAt = typeof it.reminderAt === 'string' && it.reminderAt.length > 0
      ? (() => {
          const d = new Date(it.reminderAt);
          if (!Number.isFinite(d.getTime())) return null;
          if (d.getTime() < Date.now()) {
            skipped.push(`Watchlist item "${title}": reminderAt dropped (past timestamp)`);
            return null;
          }
          return d;
        })()
      : null;
    const addedAt = typeof it.addedAt === 'string' && it.addedAt.length > 0
      ? (() => {
          const d = new Date(it.addedAt);
          return Number.isFinite(d.getTime()) ? d : undefined;
        })()
      : undefined;

    const tagIds: string[] = [];
    if (Array.isArray(it.tags)) {
      for (const raw of it.tags) {
        if (typeof raw !== 'string') continue;
        const n = normalizeTagName(raw);
        const id = tagIdByName.get(n);
        if (id) tagIds.push(id);
      }
    }

    await tx.watchlistItem.upsert({
      where: {
        userId_source_externalId_mediaType: {
          userId: ownerUserId,
          source: sourceRaw,
          externalId,
          mediaType,
        },
      },
      create: {
        userId: ownerUserId,
        source: sourceRaw,
        externalId,
        mediaType,
        title,
        year,
        posterUrl,
        overview,
        rating,
        reminderAt,
        ...(addedAt ? { addedAt } : {}),
        tags: { connect: tagIds.map((id) => ({ id })) },
      },
      update: {
        title,
        year,
        posterUrl: posterUrl ?? undefined,
        overview: overview ?? undefined,
        rating: rating ?? undefined,
        reminderAt,
        // Reset notifiedAt so a freshly-set reminder fires on the next poll.
        reminderNotifiedAt: null,
        // `connect` (merge) instead of `set` (replace) — re-importing a
        // backup shouldn't silently drop tags the user has added since.
        tags: { connect: tagIds.map((id) => ({ id })) },
      },
    });
    itemCount += 1;
  }

  return { items: itemCount, tags: tagCount };
}

async function applyAnimeMappingsInTxn(
  tx: Prisma.TransactionClient,
  data: ExportedAnimeMappings,
  skipped: string[],
): Promise<number> {
  if (!Array.isArray(data.mappings)) {
    skipped.push('Anime mappings: missing mappings array');
    return 0;
  }

  // Re-resolve each mapping's install-local Sonarr instance id by label. Fall
  // back to the default instance (isDefault flag, else oldest). Read inside the
  // transaction so a mapping never lands on a connection deleted mid-import.
  const sonarrConnections = await tx.serviceConnection.findMany({
    where: { type: 'SONARR' },
    select: { id: true, label: true, isDefault: true, createdAt: true },
  });
  if (sonarrConnections.length === 0) {
    skipped.push('Anime mappings: no Sonarr instances configured — skipped');
    return 0;
  }
  const idByLabel = new Map(sonarrConnections.map((c) => [c.label, c.id] as const));
  const defaultSonarr =
    sonarrConnections.find((c) => c.isDefault) ??
    [...sonarrConnections].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];

  let applied = 0;
  for (const m of data.mappings) {
    if (!m || typeof m !== 'object') continue;
    const state = typeof m.state === 'string' && ANIME_MAPPING_STATES.has(m.state) ? m.state : null;
    if (!state) {
      skipped.push(`Anime mapping skipped: unknown state "${String(m.state)}"`);
      continue;
    }
    const sonarrSeriesId = coerceIntOrNull(m.sonarrSeriesId);
    if (sonarrSeriesId === null || sonarrSeriesId <= 0) {
      skipped.push('Anime mapping skipped: invalid sonarrSeriesId');
      continue;
    }
    const label = typeof m.sonarrInstanceLabel === 'string' ? m.sonarrInstanceLabel.trim() : '';
    // A labelled mapping must land on its named instance — never silently fall
    // back to the default, which on a multi-instance install would attach it to
    // the wrong Sonarr. Hard-skip when the label is present but unmatched. When
    // the backup carries no label there's no instance to honor, so defaulting is
    // acceptable.
    if (label && !idByLabel.has(label)) {
      skipped.push(
        `Anime mapping "${m.seriesTitleSnapshot ?? sonarrSeriesId}" skipped: Sonarr instance "${label}" not found on this install.`
      );
      continue;
    }
    const instanceId = (label && idByLabel.get(label)) || defaultSonarr.id;

    // Coerce + dedupe entries (the @@unique([mappingId, anilistMediaId])), then
    // enforce exactly-one-primary.
    const seen = new Set<number>();
    const entries: { anilistMediaId: number; isPrimary: boolean; order: number; source: string; titleSnapshot: string | null }[] = [];
    for (const e of Array.isArray(m.entries) ? m.entries : []) {
      if (!e || typeof e !== 'object') continue;
      const anilistMediaId = coerceIntOrNull(e.anilistMediaId) ?? 0;
      if (anilistMediaId <= 0 || seen.has(anilistMediaId)) continue;
      seen.add(anilistMediaId);
      entries.push({
        anilistMediaId,
        isPrimary: Boolean(e.isPrimary),
        order: coerceIntOrNull(e.order) ?? 0,
        source:
          typeof e.source === 'string' && ANIME_MAPPING_ENTRY_SOURCES.has(e.source) ? e.source : 'manual',
        titleSnapshot: typeof e.titleSnapshot === 'string' ? e.titleSnapshot : null,
      });
    }

    const primaryCount = entries.filter((e) => e.isPrimary).length;
    if (entries.length > 0 && primaryCount !== 1) {
      entries.forEach((e, i) => { e.isPrimary = i === 0; });
    }

    const base = {
      state,
      matchMethod: typeof m.matchMethod === 'string' ? m.matchMethod : null,
      confidence: coerceIntOrNull(m.confidence),
      seriesTitleSnapshot:
        typeof m.seriesTitleSnapshot === 'string' && m.seriesTitleSnapshot.length > 0
          ? m.seriesTitleSnapshot
          : String(sonarrSeriesId),
      seriesYearSnapshot: coerceIntOrNull(m.seriesYearSnapshot),
      seriesTvdbIdSnapshot: coerceIntOrNull(m.seriesTvdbIdSnapshot),
      seriesTmdbIdSnapshot: coerceIntOrNull(m.seriesTmdbIdSnapshot),
    };

    const record = await tx.aniListSeriesMapping.upsert({
      where: { sonarrInstanceId_sonarrSeriesId: { sonarrInstanceId: instanceId, sonarrSeriesId } },
      update: base,
      create: { sonarrInstanceId: instanceId, sonarrSeriesId, ...base },
    });

    // Replace the entry set (deleteMany + recreate), same as persistResolution.
    await tx.aniListSeriesMappingEntry.deleteMany({ where: { mappingId: record.id } });
    if (entries.length > 0) {
      await tx.aniListSeriesMappingEntry.createMany({
        data: entries.map((e) => ({
          mappingId: record.id,
          anilistMediaId: e.anilistMediaId,
          isPrimary: e.isPrimary,
          order: e.order,
          source: e.source,
          titleSnapshot: e.titleSnapshot,
        })),
      });
    }
    applied += 1;
  }
  return applied;
}

/**
 * Restore scheduled-alert rules for one user. Occurrences are NOT imported:
 * an absolute alert's single occurrence is recreated here from absoluteNotifyAt
 * (skipped when that time has already passed — the alert would never fire), and
 * release_relative alerts are pushed to `createdReleaseRelative` so the caller
 * resolves their occurrences after the transaction commits — resolution hits
 * external APIs and must not run inside the transaction.
 */
async function applyScheduledAlertsInTxn(
  tx: Prisma.TransactionClient,
  alerts: unknown[],
  skipped: string[],
  ownerUserId: string,
  ownerLabel: string,
  createdReleaseRelative: ScheduledAlert[],
): Promise<number> {
  let applied = 0;
  const instanceExists = new Map<string, boolean>();
  for (const raw of alerts) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as Record<string, unknown>;
    const source = typeof a.source === 'string' ? a.source.toUpperCase() : '';
    const mediaType = typeof a.mediaType === 'string' ? a.mediaType.toLowerCase() : '';
    const externalId = typeof a.externalId === 'string' ? a.externalId.trim() : '';
    const title = typeof a.title === 'string' ? a.title.trim().slice(0, 200) : '';
    const scheduleMode = typeof a.scheduleMode === 'string' ? a.scheduleMode : '';
    if (
      !isValidSource(source) ||
      !isValidMediaType(mediaType) ||
      !externalId ||
      !title ||
      !isScheduleMode(scheduleMode)
    ) {
      skipped.push(`${ownerLabel}: alert skipped (missing or invalid fields)`);
      continue;
    }
    const scope =
      typeof a.scope === 'string' && isAlertScope(a.scope)
        ? a.scope
        : mediaType === 'movie' ? 'movie' : mediaType === 'anime' ? 'anime' : 'series';
    const releaseTypes = parseReleaseTypes(a.releaseTypes);
    const offsetMinutes =
      typeof a.offsetMinutes === 'number' && Number.isFinite(a.offsetMinutes)
        ? Math.max(0, Math.min(10_080, Math.round(a.offsetMinutes)))
        : DEFAULT_OFFSET_MINUTES;
    const timeZone =
      typeof a.timeZone === 'string' && isValidTimeZone(a.timeZone) ? a.timeZone : 'UTC';

    let absoluteNotifyAt: Date | null = null;
    if (scheduleMode === 'absolute') {
      const at = typeof a.absoluteNotifyAt === 'string' ? new Date(a.absoluteNotifyAt) : null;
      if (!at || !Number.isFinite(at.getTime()) || at.getTime() < Date.now() - 60_000) {
        skipped.push(`${ownerLabel}: "${title}" skipped (custom reminder time already passed)`);
        continue;
      }
      absoluteNotifyAt = at;
    }

    // Instance ids are install-local; keep only if that connection still exists.
    let instanceId = typeof a.instanceId === 'string' && a.instanceId ? a.instanceId : null;
    if (instanceId) {
      let ok = instanceExists.get(instanceId);
      if (ok === undefined) {
        ok = Boolean(
          await tx.serviceConnection.findUnique({ where: { id: instanceId }, select: { id: true } })
        );
        instanceExists.set(instanceId, ok);
      }
      if (!ok) instanceId = null;
    }

    // Idempotent re-import: an equivalent active rule already covers this target.
    const existing = await tx.scheduledAlert.findFirst({
      where: { userId: ownerUserId, source, externalId, mediaType, scope, scheduleMode, status: 'active' },
      select: { id: true },
    });
    if (existing) continue;

    // Only the known resolver-targeting keys survive; anything else is dropped.
    const metadata: Record<string, number> = {};
    const metaRaw =
      a.metadata && typeof a.metadata === 'object' && !Array.isArray(a.metadata)
        ? (a.metadata as Record<string, unknown>)
        : null;
    if (metaRaw) {
      for (const key of ['seasonNumber', 'episodeId', 'seriesId', 'movieId'] as const) {
        const v = metaRaw[key];
        if (typeof v === 'number' && Number.isFinite(v)) metadata[key] = Math.round(v);
      }
    }

    const subtitle = typeof a.subtitle === 'string' && a.subtitle ? a.subtitle.slice(0, 500) : null;
    const posterUrl =
      typeof a.posterUrl === 'string' && a.posterUrl ? validateImportedPosterUrl(a.posterUrl) : null;
    // hrefs are in-app paths; reject anything that could leave the app.
    const href =
      typeof a.href === 'string' && a.href.startsWith('/') && !a.href.startsWith('//')
        ? a.href.slice(0, 500)
        : null;

    const created = await tx.scheduledAlert.create({
      data: {
        userId: ownerUserId,
        source,
        externalId,
        mediaType,
        instanceId,
        title,
        subtitle,
        posterUrl,
        href,
        scheduleMode,
        scope,
        releaseTypes: releaseTypes as unknown as Prisma.InputJsonValue,
        offsetMinutes,
        timeZone,
        metadata: metadata as unknown as Prisma.InputJsonValue,
      },
    });
    if (scheduleMode === 'absolute' && absoluteNotifyAt) {
      // Mirrors POST /api/scheduled-alerts' absolute-occurrence shape.
      await tx.scheduledAlertOccurrence.create({
        data: {
          alertId: created.id,
          releaseAt: absoluteNotifyAt,
          notifyAt: absoluteNotifyAt,
          releaseKind: 'custom',
          targetKey: `custom:${source}:${externalId}`,
          title,
          body: subtitle ?? title,
        },
      });
    } else if (scheduleMode === 'release_relative') {
      createdReleaseRelative.push(created);
    }
    applied += 1;
  }
  return applied;
}

/**
 * Restore one user's personal dashboard layouts, upserting by the
 * (userId, name) unique key. Same widget validation/sanitization and
 * MAX_LAYOUTS cap as the global-layout import.
 */
async function applyUserDashboardLayoutsInTxn(
  tx: Prisma.TransactionClient,
  layouts: unknown[],
  skipped: string[],
  ownerUserId: string,
  ownerLabel: string,
): Promise<number> {
  const settingsRow = await tx.appSettings.findUnique({
    where: { id: 'singleton' },
    select: { discoverLayout: true },
  });
  const rawDiscover = settingsRow?.discoverLayout as unknown;
  const validatedDiscover = rawDiscover ? validateDiscoverLayout(rawDiscover) : null;
  const discoverLayout = reconcileDiscoverLayout(validatedDiscover);

  let applied = 0;
  let count = await tx.dashboardLayout.count({ where: { userId: ownerUserId } });
  for (const raw of layouts) {
    if (!raw || typeof raw !== 'object') continue;
    const layout = raw as Partial<ExportedDashboardLayout>;
    if (typeof layout.name !== 'string' || layout.name.trim().length === 0) {
      skipped.push(`${ownerLabel}: dashboard layout skipped (missing name)`);
      continue;
    }
    const name = layout.name.trim().slice(0, MAX_LAYOUT_NAME_LENGTH);
    const widgets = validateLayoutWidgets(layout.widgets);
    if (!widgets) {
      skipped.push(`${ownerLabel}: dashboard layout "${name}" skipped (invalid widgets)`);
      continue;
    }
    const sanitized = sanitizeDashboardLayout(widgets, discoverLayout);
    const existing = await tx.dashboardLayout.findFirst({
      where: { userId: ownerUserId, name },
      select: { id: true },
    });
    if (existing) {
      await tx.dashboardLayout.update({
        where: { id: existing.id },
        data: { widgets: sanitized as unknown as Prisma.InputJsonValue },
      });
    } else {
      if (count >= MAX_LAYOUTS) {
        skipped.push(`${ownerLabel}: dashboard layout "${name}" skipped (max ${MAX_LAYOUTS} layouts reached)`);
        continue;
      }
      await tx.dashboardLayout.create({
        data: {
          userId: ownerUserId,
          name,
          isBuiltIn: false,
          slug: null,
          widgets: sanitized as unknown as Prisma.InputJsonValue,
        },
      });
      count += 1;
    }
    applied += 1;
  }
  return applied;
}

async function applyUsersInTxn(
  tx: Prisma.TransactionClient,
  data: ExportedUsers,
  skipped: string[],
  importerId: string,
  createdReleaseRelative: ScheduledAlert[],
): Promise<number> {
  if (!Array.isArray(data.accounts)) {
    skipped.push('Users: missing accounts array');
    return 0;
  }

  let applied = 0;
  for (const acc of data.accounts) {
    if (!acc || typeof acc !== 'object') continue;
    const username = typeof acc.username === 'string' ? acc.username.trim() : '';
    if (!username) {
      skipped.push('User skipped: missing username');
      continue;
    }
    const exportedId = typeof acc.id === 'string' && acc.id.length > 0 ? acc.id : null;
    const isBootstrap = exportedId === BOOTSTRAP_ADMIN_ID;

    // Identity: the bootstrap admin matches by its fixed id; everyone else by id
    // first (clean re-attach on a same-install restore), then by username.
    let target = null as Awaited<ReturnType<typeof tx.user.findUnique>>;
    if (isBootstrap) {
      target = await tx.user.findUnique({ where: { id: BOOTSTRAP_ADMIN_ID } });
    } else {
      if (exportedId) target = await tx.user.findUnique({ where: { id: exportedId } });
      if (!target) target = await tx.user.findUnique({ where: { username } });
    }
    const targetId = target?.id ?? exportedId ?? undefined;

    let role = pickEnum(acc.role, USER_ROLE_VALUES, 'member');
    let status = pickEnum(acc.status, USER_STATUS_VALUES, 'active');
    let template = pickEnum(acc.template, USER_TEMPLATE_VALUES, role === 'admin' ? 'admin' : 'member');
    // The bootstrap admin is the guaranteed recovery account — never let an import
    // file demote or disable it (a hand-edited or hostile backup could otherwise lock
    // every admin out). Force its role/status/template back to the secure defaults.
    if (isBootstrap) {
      role = 'admin';
      status = 'active';
      template = 'admin';
    } else if (target && target.id === importerId) {
      // The admin performing the import must not be able to lock themselves out
      // by restoring a backup that demotes or disables their own account.
      // Preserve their existing role/template and force status active, ignoring
      // whatever the file says. (The bootstrap admin is already pinned above.)
      role = target.role;
      status = 'active';
      template = target.template;
      skipped.push(
        `User "${username}": role/status preserved — an import can't demote or disable the account performing it.`
      );
    }
    const permissions = parsePermissions(acc.permissions);
    const displayName =
      typeof acc.displayName === 'string' && acc.displayName.trim().length > 0
        ? acc.displayName.trim()
        : username;

    // Unique-column collision guards — a violation here would roll back the
    // whole import, so pre-check username/jellyfin/seerr against other rows.
    const usernameOwner = await tx.user.findUnique({ where: { username }, select: { id: true } });
    if (usernameOwner && usernameOwner.id !== targetId) {
      skipped.push(`User "${username}" skipped: username already belongs to another account`);
      continue;
    }

    let jellyfinUserId =
      typeof acc.jellyfinUserId === 'string' && acc.jellyfinUserId.length > 0 ? acc.jellyfinUserId : null;
    if (jellyfinUserId) {
      const owner = await tx.user.findUnique({ where: { jellyfinUserId }, select: { id: true } });
      if (owner && owner.id !== targetId) {
        skipped.push(`User "${username}": Jellyfin link dropped (already linked to another account)`);
        jellyfinUserId = null;
      }
    }
    let seerrUserId =
      typeof acc.seerrUserId === 'string' && acc.seerrUserId.length > 0 ? acc.seerrUserId : null;
    if (seerrUserId) {
      const owner = await tx.user.findUnique({ where: { seerrUserId }, select: { id: true } });
      if (owner && owner.id !== targetId) {
        skipped.push(`User "${username}": Seerr link dropped (already linked to another account)`);
        seerrUserId = null;
      }
    }

    // Password: exported hash → existing row's hash → null (no local login until
    // an admin sets one). Same fallback shape as service-connection secrets.
    const passwordHash =
      typeof acc.passwordHash === 'string' && acc.passwordHash.length > 0
        ? acc.passwordHash
        : target?.passwordHash ?? null;

    const baseData = {
      username,
      displayName,
      role: role as UserRole,
      status: status as UserStatus,
      template,
      permissions: permissions as unknown as Prisma.InputJsonValue,
      jellyfinUserId,
      seerrUserId,
      passwordHash,
    };

    let userId: string;
    if (target) {
      await tx.user.update({ where: { id: target.id }, data: baseData });
      userId = target.id;
      // Restoring a different password hash for an existing account must not
      // leave old cookies valid (disaster-recovery / post-compromise restore).
      // Revoke the account's live sessions when the hash actually changes.
      if (passwordHash && passwordHash !== target.passwordHash) {
        await tx.session.updateMany({
          where: { userId: target.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    } else {
      const created = await tx.user.create({
        data: { ...(exportedId ? { id: exportedId } : {}), ...baseData },
      });
      userId = created.id;
    }
    applied += 1;

    // Per-user settings. Nullable string fields are validated lightly; the
    // default-layout choices are restored by name further down, once this
    // user's own layouts have been recreated.
    if (acc.settings && typeof acc.settings === 'object') {
      const s = acc.settings;
      const timeZone =
        typeof s.timeZone === 'string' && isValidTimeZone(s.timeZone) ? s.timeZone : null;
      const settingsData = {
        timeZone,
        upcomingNotifyMode:
          typeof s.upcomingNotifyMode === 'string' && UPCOMING_NOTIFY_MODES.has(s.upcomingNotifyMode)
            ? s.upcomingNotifyMode
            : null,
        activityDigestMode:
          typeof s.activityDigestMode === 'string' && ACTIVITY_DIGEST_MODES.has(s.activityDigestMode)
            ? s.activityDigestMode
            : null,
        quietHoursEnabled: Boolean(s.quietHoursEnabled),
        quietHoursStart: clampHourOrNull(s.quietHoursStart),
        quietHoursEnd: clampHourOrNull(s.quietHoursEnd),
      };
      await tx.userSettings.upsert({
        where: { userId },
        update: settingsData,
        create: { userId, ...settingsData },
      });
    }

    // AniList identity only — tokens are left null (install-bound), so the user
    // re-authenticates after import.
    if (acc.anilist && typeof acc.anilist === 'object') {
      const a = acc.anilist;
      const linkData = {
        anilistUserId: coerceIntOrNull(a.anilistUserId),
        username: typeof a.username === 'string' ? a.username : null,
        avatar: typeof a.avatar === 'string' ? a.avatar : null,
        siteUrl: typeof a.siteUrl === 'string' ? a.siteUrl : null,
        scoreFormat: typeof a.scoreFormat === 'string' ? a.scoreFormat : null,
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
      };
      await tx.userAniListLink.upsert({
        where: { userId },
        update: linkData,
        create: { userId, ...linkData },
      });
    }

    // v2 per-account content: this user's watchlist, scheduled alerts, and
    // personal dashboard layouts. All optional — absent in v1 files.
    const ownerLabel = `User "${username}"`;
    if (acc.watchlist && typeof acc.watchlist === 'object') {
      await applyWatchlistInTxn(tx, acc.watchlist, skipped, userId);
    }
    if (Array.isArray(acc.scheduledAlerts)) {
      await applyScheduledAlertsInTxn(tx, acc.scheduledAlerts, skipped, userId, ownerLabel, createdReleaseRelative);
    }
    if (Array.isArray(acc.dashboardLayouts)) {
      await applyUserDashboardLayoutsInTxn(tx, acc.dashboardLayouts, skipped, userId, ownerLabel);
    }

    // Default-layout choices travel by name (ids are install-local). Resolve
    // against the user's own layouts first, then the global ones — a member
    // may have picked a shared built-in as their default.
    if (acc.settings && typeof acc.settings === 'object') {
      // Explicit null in the export means "no default" — clear it (null).
      // An absent field or a name that no longer resolves on this install is
      // left untouched (undefined).
      const resolveLayoutId = async (rawName: unknown): Promise<string | null | undefined> => {
        if (rawName === null) return null;
        const name = typeof rawName === 'string' ? rawName.trim() : '';
        if (!name) return undefined;
        const own = await tx.dashboardLayout.findFirst({
          where: { userId, name },
          select: { id: true },
        });
        if (own) return own.id;
        const global = await tx.dashboardLayout.findFirst({
          where: { userId: null, name },
          select: { id: true },
        });
        return global?.id ?? undefined;
      };
      const [desktopId, mobileId] = await Promise.all([
        resolveLayoutId(acc.settings.defaultDesktopLayoutName),
        resolveLayoutId(acc.settings.defaultMobileLayoutName),
      ]);
      if (desktopId !== undefined || mobileId !== undefined) {
        await tx.userSettings.upsert({
          where: { userId },
          update: {
            ...(desktopId !== undefined ? { defaultDesktopLayoutId: desktopId } : {}),
            ...(mobileId !== undefined ? { defaultMobileLayoutId: mobileId } : {}),
          },
          create: {
            userId,
            defaultDesktopLayoutId: desktopId ?? null,
            defaultMobileLayoutId: mobileId ?? null,
          },
        });
      }
    }
  }
  return applied;
}

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('settings.backup');
  if (capError) return capError;

  // Imported watchlist items are attributed to the importing admin (the export
  // format is owner-agnostic). Falls back to the bootstrap admin defensively.
  const importer = await getCurrentUser();
  const importerId = importer?.id ?? BOOTSTRAP_ADMIN_ID;

  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_IMPORT_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${MAX_IMPORT_BYTES} bytes)` },
      { status: 413 }
    );
  }

  // content-length can be spoofed or absent; enforce on the actual read body too.
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  // `raw.length` counts UTF-16 code units, not bytes — a multi-byte emoji
  // counts as 1–2 there but 4 bytes on the wire. Compare bytes against the
  // byte cap.
  if (Buffer.byteLength(raw, 'utf8') > MAX_IMPORT_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${MAX_IMPORT_BYTES} bytes)` },
      { status: 413 }
    );
  }

  let body: ImportRequestBody;
  try {
    body = JSON.parse(raw) as ImportRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Mirror of the export-side rule: a non-admin with settings.backup may only
  // restore their own watchlist and scheduled alerts (uiPrefs never reach this
  // route). Every other section writes global state — service connections,
  // user accounts, app settings, cleanup rules, layouts, notification devices.
  if (importer?.role !== 'admin') {
    const globalSections = [
      body.appSettings,
      body.serviceConnections,
      body.notificationDevice,
      body.cleanup,
      body.discoverLayout,
      body.dashboardLayouts,
      body.animeMappings,
      body.users,
    ];
    if (globalSections.some((section) => section != null)) {
      return NextResponse.json(
        { error: 'Only admins can import global settings, service connections, or user accounts' },
        { status: 403 }
      );
    }
  }

  const skipped: string[] = [];
  const appliedServices: ServiceType[] = [];
  let appliedAppSettings = false;
  let appliedNotificationRules = 0;
  let appliedCleanup = false;
  let discoverLayoutApplied = false;
  let appliedDashboardLayouts = 0;
  let appliedWatchlistItems = 0;
  let appliedWatchlistTags = 0;
  let appliedScheduledAlerts = 0;
  let appliedAnimeMappings = 0;
  let appliedUsers = 0;
  let appSettingsTxnResult: AppSettingsTxnResult | null = null;
  // release_relative alerts created during the import; occurrences are resolved
  // after commit (resolution hits Sonarr/Radarr/AniList — too slow for the txn).
  const createdReleaseRelative: ScheduledAlert[] = [];

  try {
    appSettingsTxnResult = await prisma.$transaction(async (tx) => {
      let innerAppSettings: AppSettingsTxnResult | null = null;
      if (body.appSettings && typeof body.appSettings === 'object') {
        innerAppSettings = await applyAppSettingsInTxn(tx, body.appSettings);
        appliedAppSettings = true;
      }

      if (Array.isArray(body.serviceConnections)) {
        for (const conn of body.serviceConnections) {
          const applied = await applyServiceConnectionInTxn(tx, conn, skipped);
          if (applied) appliedServices.push(applied);
        }
      }

      if (body.notificationDevice && typeof body.notificationDevice === 'object') {
        appliedNotificationRules = await applyNotificationDeviceInTxn(
          tx,
          body.notificationDevice,
          body.currentDeviceEndpoint,
          skipped
        );
      }

      if (body.cleanup && typeof body.cleanup === 'object') {
        await applyCleanupInTxn(tx, body.cleanup, skipped);
        appliedCleanup = true;
      }

      // Import discover layout
      if (body.discoverLayout && typeof body.discoverLayout === 'object') {
        const validated = validateDiscoverLayout(body.discoverLayout);
        if (validated) {
          const reconciled = reconcileDiscoverLayout(validated);
          await tx.appSettings.upsert({
            where: { id: 'singleton' },
            update: { discoverLayout: reconciled as unknown as Prisma.InputJsonValue },
            create: { id: 'singleton', discoverLayout: reconciled as unknown as Prisma.InputJsonValue },
          });
          discoverLayoutApplied = true;
        } else {
          skipped.push('Discover layout: invalid format, skipped');
        }
      }

      if (body.dashboardLayouts && typeof body.dashboardLayouts === 'object') {
        appliedDashboardLayouts = await applyDashboardLayoutsInTxn(tx, body.dashboardLayouts, skipped);
      }

      if (body.scheduledAlerts && typeof body.scheduledAlerts === 'object') {
        const alerts = Array.isArray(body.scheduledAlerts.alerts) ? body.scheduledAlerts.alerts : [];
        appliedScheduledAlerts = await applyScheduledAlertsInTxn(
          tx,
          alerts,
          skipped,
          importerId,
          'Scheduled alerts',
          createdReleaseRelative
        );
      }

      if (body.watchlist && typeof body.watchlist === 'object') {
        const r = await applyWatchlistInTxn(tx, body.watchlist, skipped, importerId);
        appliedWatchlistItems = r.items;
        appliedWatchlistTags = r.tags;
      }

      if (body.animeMappings && typeof body.animeMappings === 'object') {
        appliedAnimeMappings = await applyAnimeMappingsInTxn(tx, body.animeMappings, skipped);
      }

      if (body.users && typeof body.users === 'object') {
        appliedUsers = await applyUsersInTxn(tx, body.users, skipped, importerId, createdReleaseRelative);
      }

      return innerAppSettings;
    });
  } catch (error) {
    console.error('Failed to import settings', error);
    return NextResponse.json(
      { error: 'Failed to import settings' },
      { status: 500 }
    );
  }

  // All DB writes committed — now run side effects. Failures here are logged
  // but don't roll back the import (the data is already persisted).
  let pollingRestarted = true;
  if (appSettingsTxnResult) {
    const { settings, wasCachingEnabled, pollingIntervalSecsChanged } = appSettingsTxnResult;
    setCachedCacheImagesEnabled(settings.cacheImagesEnabled);
    setCachedAnilistTtlSettings({
      sectionsTtlMin: settings.anilistSectionsTtlMin,
      browseTtlMin: settings.anilistBrowseTtlMin,
      detailTtlMin: settings.anilistDetailTtlMin,
      airingTtlMin: settings.anilistAiringTtlMin,
    });
    setAppTimeZone(settings.timeZone);
    configureLogger({
      timeZone: settings.timeZone,
      level: settings.logLevel as 'debug' | 'info' | 'warn' | 'error',
      maxFileMb: settings.logMaxFileMb,
      retentionDays: settings.logRetentionDays,
      enabled: settings.logEnabled,
    });
    configureApiLogging({
      enabled: settings.logEnabled,
      failedRequestBodies: settings.logFailedRequestBodies,
      failedResponseBodies: settings.logFailedResponseBodies,
    });

    if (wasCachingEnabled && settings.cacheImagesEnabled === false) {
      try {
        await disableCachingAndPurgeCaches();
      } catch (err) {
        console.error('Failed to purge cache after import-disable', err);
      }
    }

    if (pollingIntervalSecsChanged !== null) {
      try {
        pollingService.restart(pollingIntervalSecsChanged * 1000);
      } catch (err) {
        pollingRestarted = false;
        console.warn('Failed to restart polling after import', err);
      }
    }
    // Ensure singleton init path runs and any in-process caches are seeded.
    await getOrCreateAppSettings();
  }

  // After cleanup rules are replaced, restart the cleaner schedulers so the
  // new intervals/modes take effect and prune any strikes whose ruleId no
  // longer exists.
  if (appliedCleanup) {
    try {
      await pruneStrikesForMissingRules();
    } catch (err) {
      console.warn('Failed to prune orphan strikes after cleanup import', err);
    }
    try {
      await Promise.all([restartQueueCleaner(), restartDownloadCleaner()]);
    } catch (err) {
      console.warn('Failed to restart cleanup schedulers after import', err);
    }
  }

  // Materialize occurrences for imported release_relative alerts, mirroring
  // POST /api/scheduled-alerts. Without this they'd stay inert until the
  // background refresh reaches them (it processes oldest-updated first, so
  // fresh imports would be last in line).
  if (createdReleaseRelative.length > 0) {
    const ctx = createResolverContext({
      maxOffsetMinutes: Math.max(...createdReleaseRelative.map((a) => a.offsetMinutes)),
    });
    for (const alert of createdReleaseRelative) {
      try {
        const { candidates, resolved } = await resolveAlertOccurrencesResult(alert, ctx);
        await upsertOccurrencesForAlert(alert, candidates, { resolved });
      } catch (err) {
        console.warn('Failed to resolve occurrences for imported alert', alert.id, err);
      }
    }
  }

  // After dashboard layouts change, drop the cached active layouts so the next
  // dashboard fetch reads the new defaults.
  if (appliedDashboardLayouts > 0) {
    try {
      await invalidateLayoutCache();
    } catch (err) {
      console.warn('Failed to invalidate dashboard layout cache after import', err);
    }
  }

  // Ensure exactly one default per imported type (export isDefault flags were
  // applied on create; this promotes the oldest if none/many ended up flagged).
  if (appliedServices.length > 0) {
    for (const type of new Set(appliedServices)) {
      try {
        await ensureDefaultForType(type);
      } catch (err) {
        console.warn('Failed to ensure default instance after import', err);
      }
    }
    clearConnectionMemo();
  }

  const result: ImportResult = {
    applied: {
      appSettings: appliedAppSettings,
      services: appliedServices,
      notificationRules: appliedNotificationRules,
      cleanup: appliedCleanup,
      dashboardLayouts: appliedDashboardLayouts,
      watchlistItems: appliedWatchlistItems,
      watchlistTags: appliedWatchlistTags,
      scheduledAlerts: appliedScheduledAlerts,
      animeMappings: appliedAnimeMappings,
      users: appliedUsers,
    },
    skipped,
    pollingRestarted,
    discoverLayoutApplied,
  };
  return NextResponse.json(result);
}

export const POST = withApiLogging(postHandler, 'api/settings/import', { logBodies: false });
