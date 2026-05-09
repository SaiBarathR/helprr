import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { pollingService } from '@/lib/polling-service';
import { disableCachingAndPurgeCaches } from '@/lib/cache/admin';
import { setCachedCacheImagesEnabled } from '@/lib/cache/state';
import { getOrCreateAppSettings } from '@/lib/app-settings';
import { configureLogger } from '@/lib/logger';
import { configureApiLogging, withApiLogging } from '@/lib/api-logger';
import { getEnvTimeZone, isValidTimeZone, setAppTimeZone } from '@/lib/timezone';

const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);

/**
 * Retrieve the singleton application settings, creating a record with defaults if none exists.
 *
 * @returns The app settings record (singleton) as persisted in the database.
 */
async function getHandler() {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const settings = await getOrCreateAppSettings();

    return NextResponse.json({
      ...settings,
      envTimeZone: getEnvTimeZone(),
    });
  } catch (error) {
    console.error('Failed to fetch settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch settings' },
      { status: 500 }
    );
  }
}

/**
 * Update or create the singleton application settings using values from the request body.
 *
 * Accepts a JSON body with any of the following optional fields to update the singleton settings:
 * `pollingIntervalSecs`, `dashboardRefreshIntervalSecs`, `activityRefreshIntervalSecs`, `torrentsRefreshIntervalSecs`,
 * `theme`, `upcomingAlertHours`, `upcomingNotifyMode`, `upcomingNotifyBeforeMins`, `upcomingDailyNotifyHour`.
 *
 * @param request - Incoming Next.js request whose JSON body supplies the settings to set or update.
 * @returns The resulting settings object as JSON on success; on failure returns `{ error: 'Failed to update settings' }` with HTTP status 500.
 */
async function putHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const body = await request.json();
    const {
      pollingIntervalSecs, theme, upcomingAlertHours,
      dashboardRefreshIntervalSecs, activityRefreshIntervalSecs, torrentsRefreshIntervalSecs,
      upcomingNotifyMode, upcomingNotifyBeforeMins, upcomingDailyNotifyHour,
      cacheImagesEnabled,
      timeZone,
      logLevel,
      logMaxFileMb,
      logRetentionDays,
      logClientConsoleEnabled,
      logFailedRequestBodies,
      logFailedResponseBodies,
    } = body;

    const current = await prisma.appSettings.findUnique({
      where: { id: 'singleton' },
    });

    const data: Record<string, unknown> = {};
    if (pollingIntervalSecs !== undefined)
      data.pollingIntervalSecs = pollingIntervalSecs;
    if (dashboardRefreshIntervalSecs !== undefined)
      data.dashboardRefreshIntervalSecs = dashboardRefreshIntervalSecs;
    if (activityRefreshIntervalSecs !== undefined)
      data.activityRefreshIntervalSecs = activityRefreshIntervalSecs;
    if (torrentsRefreshIntervalSecs !== undefined)
      data.torrentsRefreshIntervalSecs = torrentsRefreshIntervalSecs;
    if (theme !== undefined) data.theme = theme;
    if (upcomingAlertHours !== undefined)
      data.upcomingAlertHours = upcomingAlertHours;
    if (upcomingNotifyMode !== undefined)
      data.upcomingNotifyMode = upcomingNotifyMode;
    if (upcomingNotifyBeforeMins !== undefined)
      data.upcomingNotifyBeforeMins = upcomingNotifyBeforeMins;
    if (upcomingDailyNotifyHour !== undefined)
      data.upcomingDailyNotifyHour = upcomingDailyNotifyHour;
    if (cacheImagesEnabled !== undefined)
      data.cacheImagesEnabled = Boolean(cacheImagesEnabled);
    if (timeZone !== undefined) {
      const nextTimeZone = typeof timeZone === 'string' && timeZone.trim().length > 0
        ? timeZone.trim()
        : getEnvTimeZone();
      if (!isValidTimeZone(nextTimeZone)) {
        return NextResponse.json(
          { error: 'Invalid timezone' },
          { status: 400 }
        );
      }
      data.timeZone = nextTimeZone;
    }
    if (logLevel !== undefined) {
      if (typeof logLevel !== 'string' || !LOG_LEVELS.has(logLevel)) {
        return NextResponse.json(
          { error: 'Invalid log level' },
          { status: 400 }
        );
      }
      data.logLevel = logLevel;
    }
    if (logMaxFileMb !== undefined) {
      const parsed = Number(logMaxFileMb);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1024) {
        return NextResponse.json(
          { error: 'Log max file size must be between 1 and 1024 MB' },
          { status: 400 }
        );
      }
      data.logMaxFileMb = parsed;
    }
    if (logRetentionDays !== undefined) {
      const parsed = Number(logRetentionDays);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3650) {
        return NextResponse.json(
          { error: 'Log retention must be between 1 and 3650 days' },
          { status: 400 }
        );
      }
      data.logRetentionDays = parsed;
    }
    if (logClientConsoleEnabled !== undefined)
      data.logClientConsoleEnabled = Boolean(logClientConsoleEnabled);
    if (logFailedRequestBodies !== undefined)
      data.logFailedRequestBodies = Boolean(logFailedRequestBodies);
    if (logFailedResponseBodies !== undefined)
      data.logFailedResponseBodies = Boolean(logFailedResponseBodies);

    const settings = await prisma.appSettings.upsert({
      where: { id: 'singleton' },
      update: data,
      create: {
        id: 'singleton',
        pollingIntervalSecs: pollingIntervalSecs ?? 30,
        dashboardRefreshIntervalSecs: dashboardRefreshIntervalSecs ?? 5,
        activityRefreshIntervalSecs: activityRefreshIntervalSecs ?? 5,
        torrentsRefreshIntervalSecs: torrentsRefreshIntervalSecs ?? 5,
        cacheImagesEnabled: cacheImagesEnabled ?? true,
        theme: theme ?? 'dark',
        timeZone: timeZone ?? getEnvTimeZone(),
        logLevel: logLevel ?? 'debug',
        logMaxFileMb: logMaxFileMb ?? 50,
        logRetentionDays: logRetentionDays ?? 30,
        logClientConsoleEnabled: logClientConsoleEnabled ?? true,
        logFailedRequestBodies: logFailedRequestBodies ?? true,
        logFailedResponseBodies: logFailedResponseBodies ?? true,
        upcomingAlertHours: upcomingAlertHours ?? 24,
        upcomingNotifyMode: upcomingNotifyMode ?? 'before_air',
        upcomingNotifyBeforeMins: upcomingNotifyBeforeMins ?? 60,
        upcomingDailyNotifyHour: upcomingDailyNotifyHour ?? 9,
      },
    });

    setCachedCacheImagesEnabled(settings.cacheImagesEnabled);
    setAppTimeZone(settings.timeZone);
    configureLogger({
      timeZone: settings.timeZone,
      level: settings.logLevel as 'debug' | 'info' | 'warn' | 'error',
      maxFileMb: settings.logMaxFileMb,
      retentionDays: settings.logRetentionDays,
    });
    configureApiLogging({
      failedRequestBodies: settings.logFailedRequestBodies,
      failedResponseBodies: settings.logFailedResponseBodies,
    });

    const disabledNow = (current?.cacheImagesEnabled ?? true) && settings.cacheImagesEnabled === false;
    let cachePurge: Awaited<ReturnType<typeof disableCachingAndPurgeCaches>> | null = null;
    if (disabledNow) {
      try {
        cachePurge = await disableCachingAndPurgeCaches();
      } catch (cachePurgeError) {
        console.error('Failed to purge cache after disabling image caching', {
          message: cachePurgeError instanceof Error ? cachePurgeError.message : String(cachePurgeError),
          stack: cachePurgeError instanceof Error ? cachePurgeError.stack : undefined,
        });
        cachePurge = null;
      }
    }

    if (pollingIntervalSecs !== undefined) {
      const validatedPollingIntervalSecs = Number(pollingIntervalSecs);
      if (Number.isFinite(validatedPollingIntervalSecs) && validatedPollingIntervalSecs > 0) {
        try {
          pollingService.restart(validatedPollingIntervalSecs * 1000);
        } catch (restartError) {
          console.warn('Failed to restart polling service after settings update', {
            pollingIntervalSecs: validatedPollingIntervalSecs,
            error: restartError,
          });
        }
      } else {
        console.warn('Skipping polling restart due to invalid pollingIntervalSecs', {
          pollingIntervalSecs,
        });
      }
    }

    return NextResponse.json({
      ...settings,
      envTimeZone: getEnvTimeZone(),
      cachePurge,
    });
  } catch (error) {
    console.error('Failed to update settings:', error);
    return NextResponse.json(
      { error: 'Failed to update settings' },
      { status: 500 }
    );
  }
}

export const GET = withApiLogging(getHandler, 'api/settings');
export const PUT = withApiLogging(putHandler, 'api/settings');
