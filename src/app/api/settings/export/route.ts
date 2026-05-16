import { NextRequest, NextResponse } from 'next/server';
import type { ServiceType } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { getOrCreateAppSettings } from '@/lib/app-settings';
import { withApiLogging } from '@/lib/api-logger';
import {
  type ExportedCleanup,
  type ExportedNotificationDevice,
  type ExportedNotificationRule,
  type ExportedServiceConnection,
  type SettingsExportPayload,
  EXPORT_FORMAT_KIND,
  EXPORT_FORMAT_VERSION,
  SERVICE_TYPES_EXPORTABLE,
} from '@/lib/settings-export';
import { EVENT_TYPES, type NotificationEventType } from '@/lib/notification-events';
import { STORE_VERSION } from '@/lib/store';
import { loadQueueCleanerConfig, loadStallRules, loadSlowRules } from '@/lib/cleanup/queue-cleaner';
import { loadDownloadCleanerConfig, loadSeedingRules } from '@/lib/cleanup/download-cleaner';

interface ExportRequestBody {
  appSettings?: boolean;
  discoverLayout?: boolean;
  services?: string[] | false;
  notificationPrefs?: boolean;
  cleanup?: boolean;
  includeSecrets?: boolean;
}

async function postHandler(request: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  let body: ExportRequestBody;
  try {
    body = (await request.json()) as ExportRequestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const includeSecrets = body.includeSecrets === true;
  const wantAppSettings = body.appSettings === true;
  const wantDiscoverLayout = body.discoverLayout === true;
  const wantNotificationPrefs = body.notificationPrefs === true;
  const wantCleanup = body.cleanup === true;
  const selectedServices: ServiceType[] = Array.isArray(body.services)
    ? (SERVICE_TYPES_EXPORTABLE.filter((t) => (body.services as string[]).includes(t)) as ServiceType[])
    : [];

  const payload: Omit<SettingsExportPayload, 'uiPrefs'> = {
    kind: EXPORT_FORMAT_KIND,
    version: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    zustandVersion: STORE_VERSION,
    includesSecrets: includeSecrets,
  };

  try {
    // Load AppSettings once if either appSettings or discoverLayout is requested
    // (both live on the same singleton row).
    const settings = wantAppSettings || wantDiscoverLayout
      ? await getOrCreateAppSettings()
      : null;

    if (wantAppSettings && settings) {
      payload.appSettings = {
        pollingIntervalSecs: settings.pollingIntervalSecs,
        dashboardRefreshIntervalSecs: settings.dashboardRefreshIntervalSecs,
        activityRefreshIntervalSecs: settings.activityRefreshIntervalSecs,
        torrentsRefreshIntervalSecs: settings.torrentsRefreshIntervalSecs,
        cacheImagesEnabled: settings.cacheImagesEnabled,
        theme: settings.theme,
        timeZone: settings.timeZone,
        logEnabled: settings.logEnabled,
        logLevel: settings.logLevel,
        logMaxFileMb: settings.logMaxFileMb,
        logRetentionDays: settings.logRetentionDays,
        logClientConsoleEnabled: settings.logClientConsoleEnabled,
        logFailedRequestBodies: settings.logFailedRequestBodies,
        logFailedResponseBodies: settings.logFailedResponseBodies,
        upcomingAlertHours: settings.upcomingAlertHours,
        upcomingNotifyMode: settings.upcomingNotifyMode,
        upcomingNotifyBeforeMins: settings.upcomingNotifyBeforeMins,
        upcomingDailyNotifyHour: settings.upcomingDailyNotifyHour,
      };
    }

    if (wantDiscoverLayout && settings?.discoverLayout) {
      payload.discoverLayout = settings.discoverLayout as Record<string, unknown>;
    }

    if (selectedServices.length > 0) {
      const connections = await prisma.serviceConnection.findMany({
        where: { type: { in: selectedServices } },
        orderBy: { type: 'asc' },
      });
      const exported: ExportedServiceConnection[] = connections.map((c) => ({
        type: c.type,
        url: c.url,
        externalUrl: c.externalUrl ?? null,
        username: c.username ?? null,
        apiKey: includeSecrets ? c.apiKey : null,
        accessToken: includeSecrets ? (c.accessToken ?? null) : null,
        refreshToken: includeSecrets ? (c.refreshToken ?? null) : null,
      }));
      payload.serviceConnections = exported;
    }

    if (wantNotificationPrefs) {
      const rows = await prisma.notificationPreference.findMany({
        include: { subscription: { select: { id: true, deviceName: true } } },
        orderBy: [{ subscriptionId: 'asc' }, { eventType: 'asc' }],
      });
      const grouped = new Map<string, { deviceName: string; rules: ExportedNotificationRule[] }>();
      for (const row of rows) {
        if (!(EVENT_TYPES as readonly string[]).includes(row.eventType)) continue;
        const key = row.subscription.id;
        const deviceName = row.subscription.deviceName?.trim() || `Device ${key.slice(0, 6)}`;
        const entry = grouped.get(key) ?? { deviceName, rules: [] };
        entry.rules.push({
          eventType: row.eventType as NotificationEventType,
          enabled: row.enabled,
          tagFilter: row.tagFilter ?? null,
          qualityFilter: row.qualityFilter ?? null,
        });
        grouped.set(key, entry);
      }
      const devices: ExportedNotificationDevice[] = [];
      const seenNames = new Map<string, number>();
      for (const { deviceName, rules } of grouped.values()) {
        const count = (seenNames.get(deviceName) ?? 0) + 1;
        seenNames.set(deviceName, count);
        const uniqueName = count === 1 ? deviceName : `${deviceName} (${count})`;
        devices.push({ deviceName: uniqueName, rules });
      }
      payload.notificationPrefs = devices;
    }

    if (wantCleanup) {
      const [queueConfig, downloadConfig, stallRules, slowRules, seedingRules] = await Promise.all([
        loadQueueCleanerConfig(),
        loadDownloadCleanerConfig(),
        loadStallRules(),
        loadSlowRules(),
        loadSeedingRules(),
      ]);
      const cleanup: ExportedCleanup = {
        queueConfig,
        downloadConfig,
        stallRules,
        slowRules,
        seedingRules: seedingRules.filter((r) => !r.isSystem),
      };
      payload.cleanup = cleanup;
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error('Failed to build settings export', error);
    return NextResponse.json({ error: 'Failed to build export' }, { status: 500 });
  }
}

export const POST = withApiLogging(postHandler, 'api/settings/export', { logBodies: false });
