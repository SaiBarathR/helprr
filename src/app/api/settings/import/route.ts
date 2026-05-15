import { NextRequest, NextResponse } from 'next/server';
import type { AppSettings, Prisma, ServiceType } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { pollingService } from '@/lib/polling-service';
import { setCachedCacheImagesEnabled } from '@/lib/cache/state';
import { disableCachingAndPurgeCaches } from '@/lib/cache/admin';
import { setAppTimeZone, isValidTimeZone, getEnvTimeZone } from '@/lib/timezone';
import { configureLogger } from '@/lib/logger';
import { configureApiLogging } from '@/lib/api-logger';
import { getOrCreateAppSettings } from '@/lib/app-settings';
import { EVENT_TYPES } from '@/lib/notification-events';
import { isServiceType } from '@/lib/service-connection-secrets';
import {
  type ExportedAppSettings,
  type ExportedCleanup,
  type ExportedServiceConnection,
  type ExportedNotificationDevice,
} from '@/lib/settings-export';
import { restartDownloadCleaner, restartQueueCleaner } from '@/lib/cleanup/scheduler';
import { pruneStrikesForMissingRules } from '@/lib/cleanup/strikes';

const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const THEMES = new Set(['dark', 'light', 'system']);
const UPCOMING_NOTIFY_MODES = new Set(['once_in_window', 'before_air', 'daily_digest']);
const MAX_IMPORT_BYTES = 1_048_576;

interface ImportRequestBody {
  appSettings?: Partial<ExportedAppSettings>;
  serviceConnections?: ExportedServiceConnection[];
  notificationDevice?: ExportedNotificationDevice;
  cleanup?: ExportedCleanup;
  currentDeviceEndpoint?: string;
}

interface ImportResult {
  applied: {
    appSettings: boolean;
    services: ServiceType[];
    notificationRules: number;
    cleanup: boolean;
  };
  skipped: string[];
  pollingRestarted: boolean;
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
  if (input.dashboardRefreshIntervalSecs !== undefined)
    out.dashboardRefreshIntervalSecs = clampInt(input.dashboardRefreshIntervalSecs, 1, 86_400, 5);
  if (input.activityRefreshIntervalSecs !== undefined)
    out.activityRefreshIntervalSecs = clampInt(input.activityRefreshIntervalSecs, 1, 86_400, 5);
  if (input.torrentsRefreshIntervalSecs !== undefined)
    out.torrentsRefreshIntervalSecs = clampInt(input.torrentsRefreshIntervalSecs, 1, 86_400, 5);
  if (input.cacheImagesEnabled !== undefined)
    out.cacheImagesEnabled = Boolean(input.cacheImagesEnabled);
  if (input.theme !== undefined) out.theme = pickEnum(input.theme, THEMES, 'dark');
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
  if (input.logClientConsoleEnabled !== undefined)
    out.logClientConsoleEnabled = Boolean(input.logClientConsoleEnabled);
  if (input.logFailedRequestBodies !== undefined)
    out.logFailedRequestBodies = Boolean(input.logFailedRequestBodies);
  if (input.logFailedResponseBodies !== undefined)
    out.logFailedResponseBodies = Boolean(input.logFailedResponseBodies);
  if (input.upcomingAlertHours !== undefined)
    out.upcomingAlertHours = clampInt(input.upcomingAlertHours, 1, 8760, 24);
  if (input.upcomingNotifyMode !== undefined)
    out.upcomingNotifyMode = pickEnum(input.upcomingNotifyMode, UPCOMING_NOTIFY_MODES, 'before_air');
  if (input.upcomingNotifyBeforeMins !== undefined)
    out.upcomingNotifyBeforeMins = clampInt(input.upcomingNotifyBeforeMins, 1, 10_080, 60);
  if (input.upcomingDailyNotifyHour !== undefined)
    out.upcomingDailyNotifyHour = clampInt(input.upcomingDailyNotifyHour, 0, 23, 9);
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
      dashboardRefreshIntervalSecs: (data.dashboardRefreshIntervalSecs as number | undefined) ?? 5,
      activityRefreshIntervalSecs: (data.activityRefreshIntervalSecs as number | undefined) ?? 5,
      torrentsRefreshIntervalSecs: (data.torrentsRefreshIntervalSecs as number | undefined) ?? 5,
      cacheImagesEnabled: (data.cacheImagesEnabled as boolean | undefined) ?? true,
      theme: (data.theme as string | undefined) ?? 'dark',
      timeZone: (data.timeZone as string | undefined) ?? getEnvTimeZone(),
      logEnabled: (data.logEnabled as boolean | undefined) ?? true,
      logLevel: (data.logLevel as string | undefined) ?? 'debug',
      logMaxFileMb: (data.logMaxFileMb as number | undefined) ?? 50,
      logRetentionDays: (data.logRetentionDays as number | undefined) ?? 30,
      logClientConsoleEnabled: (data.logClientConsoleEnabled as boolean | undefined) ?? true,
      logFailedRequestBodies: (data.logFailedRequestBodies as boolean | undefined) ?? false,
      logFailedResponseBodies: (data.logFailedResponseBodies as boolean | undefined) ?? false,
      upcomingAlertHours: (data.upcomingAlertHours as number | undefined) ?? 24,
      upcomingNotifyMode: (data.upcomingNotifyMode as string | undefined) ?? 'before_air',
      upcomingNotifyBeforeMins: (data.upcomingNotifyBeforeMins as number | undefined) ?? 60,
      upcomingDailyNotifyHour: (data.upcomingDailyNotifyHour as number | undefined) ?? 9,
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

  const existing = await tx.serviceConnection.findUnique({ where: { type: conn.type } });
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

  await tx.serviceConnection.upsert({
    where: { type: conn.type },
    update: {
      url, apiKey, username, externalUrl,
      ...(accessToken !== null && { accessToken }),
      ...(refreshToken !== null && { refreshToken }),
    },
    create: {
      type: conn.type, url, apiKey, username, externalUrl,
      ...(accessToken !== null && { accessToken }),
      ...(refreshToken !== null && { refreshToken }),
    },
  });
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
      },
      create: {
        subscriptionId: subscription.id,
        eventType: rule.eventType,
        enabled: Boolean(rule.enabled),
        tagFilter: rule.tagFilter ?? null,
        qualityFilter: rule.qualityFilter ?? null,
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
        autoRunMode: typeof c.autoRunMode === 'string' ? c.autoRunMode : 'disabled',
      },
      update: {
        enabled: Boolean(c.enabled),
        intervalMinutes: Math.max(1, Number(c.intervalMinutes) || 60),
        ignoredDownloads: Array.isArray(c.ignoredDownloads) ? c.ignoredDownloads : [],
        autoRemoveImportedEnabled: Boolean(c.autoRemoveImportedEnabled),
        autoRemoveImportedCategories: Array.isArray(c.autoRemoveImportedCategories) ? c.autoRemoveImportedCategories : [],
        autoRemoveImportedDeleteFiles: Boolean(c.autoRemoveImportedDeleteFiles),
        autoRunMode: typeof c.autoRunMode === 'string' ? c.autoRunMode : 'disabled',
      },
    });
  } else {
    skipped.push('Cleanup: downloadConfig missing or invalid');
  }

  // Replace user-defined rules with the imported set. System rules (the
  // synthetic auto-remove-imported seeding rule) are preserved — they're
  // managed by saveDownloadCleanerConfig and will be re-synced on next save.
  // Only delete when a valid replacement array is supplied, so a missing or
  // malformed key doesn't silently wipe existing rules.
  if (Array.isArray(data.stallRules)) {
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

  if (Array.isArray(data.slowRules)) {
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

  if (Array.isArray(data.seedingRules)) {
    await tx.seedingRule.deleteMany({ where: { isSystem: false } });
    for (const r of data.seedingRules) {
      if (!r || typeof r !== 'object') continue;
      await tx.seedingRule.create({
        data: {
          name: String(r.name ?? 'Seeding rule'),
          enabled: Boolean(r.enabled),
          priority: Number(r.priority) || 0,
          categories: Array.isArray(r.categories) ? r.categories : [],
          trackerPatterns: Array.isArray(r.trackerPatterns) ? r.trackerPatterns : [],
          tagsAny: Array.isArray(r.tagsAny) ? r.tagsAny : [],
          tagsAll: Array.isArray(r.tagsAll) ? r.tagsAll : [],
          privacyType: String(r.privacyType ?? 'both'),
          maxRatio: Number.isFinite(Number(r.maxRatio)) ? Number(r.maxRatio) : 1,
          minSeedTimeHours: Math.max(0, Number(r.minSeedTimeHours) || 0),
          maxSeedTimeHours: Number.isFinite(Number(r.maxSeedTimeHours)) ? Number(r.maxSeedTimeHours) : -1,
          deleteSourceFiles: Boolean(r.deleteSourceFiles),
          isSystem: false,
        },
      });
    }
  }
}

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

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
  if (raw.length > MAX_IMPORT_BYTES) {
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

  const skipped: string[] = [];
  const appliedServices: ServiceType[] = [];
  let appliedAppSettings = false;
  let appliedNotificationRules = 0;
  let appliedCleanup = false;
  let appSettingsTxnResult: AppSettingsTxnResult | null = null;

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

  const result: ImportResult = {
    applied: {
      appSettings: appliedAppSettings,
      services: appliedServices,
      notificationRules: appliedNotificationRules,
      cleanup: appliedCleanup,
    },
    skipped,
    pollingRestarted,
  };
  return NextResponse.json(result);
}

export const POST = withApiLogging(postHandler, 'api/settings/import', { logBodies: false });
