// App settings section of a settings import.

import type { AppSettings, Prisma } from '@prisma/client';
import { isValidTimeZone, getEnvTimeZone } from '@/lib/timezone';
import { parseBandwidthSchedule } from '@/lib/bandwidth-scheduler/parse';
import { parseDiskThresholds } from '@/lib/disk-space';
import { normalizeRegionCode } from '@/lib/region';
import type { ExportedAppSettings } from '@/lib/settings-export';
import {
  LOG_LEVELS,
  UPCOMING_NOTIFY_MODES,
  ACTIVITY_DIGEST_MODES,
  clampInt,
  pickEnum,
} from './shared';

export function buildAppSettingsUpdate(
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

export interface AppSettingsTxnResult {
  appliedKeys: string[];
  wasCachingEnabled: boolean;
  pollingIntervalSecsChanged: number | null;
  settings: AppSettings;
}

export async function applyAppSettingsInTxn(
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
