import { NextRequest, NextResponse } from 'next/server';
import type { ServiceType } from '@prisma/client';
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
  type ExportedServiceConnection,
  type ExportedNotificationDevice,
} from '@/lib/settings-export';

const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const THEMES = new Set(['dark', 'light', 'system']);
const UPCOMING_NOTIFY_MODES = new Set(['once_in_window', 'before_air', 'daily_digest']);

interface ImportRequestBody {
  appSettings?: Partial<ExportedAppSettings>;
  serviceConnections?: ExportedServiceConnection[];
  notificationDevice?: ExportedNotificationDevice;
  currentDeviceEndpoint?: string;
}

interface ImportResult {
  applied: {
    appSettings: boolean;
    services: ServiceType[];
    notificationRules: number;
  };
  skipped: string[];
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

async function applyAppSettings(input: Partial<ExportedAppSettings>): Promise<void> {
  const data = buildAppSettingsUpdate(input);
  if (Object.keys(data).length === 0) return;

  const current = await prisma.appSettings.findUnique({ where: { id: 'singleton' } });
  const wasCachingEnabled = current?.cacheImagesEnabled ?? true;

  const settings = await prisma.appSettings.upsert({
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

  if (data.pollingIntervalSecs !== undefined) {
    try {
      pollingService.restart((data.pollingIntervalSecs as number) * 1000);
    } catch (err) {
      console.warn('Failed to restart polling after import', err);
    }
  }
  // Touch to ensure the singleton init path runs (and seeds defaults if absent)
  await getOrCreateAppSettings();
}

async function applyServiceConnection(
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

  const existing = await prisma.serviceConnection.findUnique({ where: { type: conn.type } });
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

  await prisma.serviceConnection.upsert({
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

async function applyNotificationDevice(
  device: ExportedNotificationDevice,
  currentDeviceEndpoint: string | undefined,
  skipped: string[]
): Promise<number> {
  if (!currentDeviceEndpoint) {
    skipped.push('Notification prefs: no active push subscription on this device');
    return 0;
  }
  const subscription = await prisma.pushSubscription.findUnique({
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
    await prisma.notificationPreference.upsert({
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

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  let body: ImportRequestBody;
  try {
    body = (await request.json()) as ImportRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const result: ImportResult = {
    applied: { appSettings: false, services: [], notificationRules: 0 },
    skipped: [],
  };

  try {
    if (body.appSettings && typeof body.appSettings === 'object') {
      await applyAppSettings(body.appSettings);
      result.applied.appSettings = true;
    }

    if (Array.isArray(body.serviceConnections)) {
      for (const conn of body.serviceConnections) {
        const applied = await applyServiceConnection(conn, result.skipped);
        if (applied) result.applied.services.push(applied);
      }
    }

    if (body.notificationDevice && typeof body.notificationDevice === 'object') {
      result.applied.notificationRules = await applyNotificationDevice(
        body.notificationDevice,
        body.currentDeviceEndpoint,
        result.skipped
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to import settings', error);
    return NextResponse.json(
      { error: 'Failed to import settings', detail: (error as Error)?.message },
      { status: 500 }
    );
  }
}

export const POST = withApiLogging(postHandler, 'api/settings/import', { logBodies: false });
