export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initializeServerLogging, configureLogger } = await import('@/lib/logger');
    initializeServerLogging();

    const { getJwtSecret } = await import('@/lib/jwt-secret');
    const { registerRedisShutdownHandlers } = await import('@/lib/redis');

    getJwtSecret();
    registerRedisShutdownHandlers();

    const { pollingService } = await import('@/lib/polling-service');
    const { getOrCreateAppSettings } = await import('@/lib/app-settings');
    const { configureApiLogging } = await import('@/lib/api-logger');

    try {
      const settings = await getOrCreateAppSettings();
      const { setAppTimeZone } = await import('@/lib/timezone');
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

      const intervalMs = settings.pollingIntervalSecs * 1000;
      pollingService.start(intervalMs);
      console.log('[Helprr] Polling service started');
    } catch (e) {
      console.warn('[Helprr] Could not start polling service:', e);
    }
  }
}
