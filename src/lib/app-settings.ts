import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getEnvTimeZone, normalizeTimeZone } from '@/lib/timezone';

export const DEFAULT_LOG_LEVEL = 'debug';
export const DEFAULT_LOG_MAX_FILE_MB = 50;
export const DEFAULT_LOG_RETENTION_DAYS = 30;

export function buildDefaultAppSettings(): Prisma.AppSettingsCreateInput {
  return {
    id: 'singleton',
    pollingIntervalSecs: 30,
    activityRefreshIntervalSecs: 5,
    torrentsRefreshIntervalSecs: 5,
    cacheImagesEnabled: true,
    timeZone: getEnvTimeZone(),
    logEnabled: true,
    logLevel: DEFAULT_LOG_LEVEL,
    logMaxFileMb: DEFAULT_LOG_MAX_FILE_MB,
    logRetentionDays: DEFAULT_LOG_RETENTION_DAYS,
    logClientConsoleEnabled: true,
    logFailedRequestBodies: false,
    logFailedResponseBodies: false,
    upcomingNotifyMode: 'before_air',
    upcomingNotifyBeforeMins: 60,
    upcomingDailyNotifyHour: 9,
    watchProviderRegion: 'US',
    activityDigestMode: 'off',
    activityDigestHour: 8,
    activityDigestDayOfWeek: 1,
  };
}

export async function getOrCreateAppSettings() {
  const settings = await prisma.appSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: buildDefaultAppSettings(),
  });

  return {
    ...settings,
    timeZone: normalizeTimeZone(settings.timeZone),
  };
}
