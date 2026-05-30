export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Disable Happy Eyeballs before anything opens a socket. Node 19+ defaults
    // autoSelectFamily to true with a 250ms per-attempt budget, which is
    // shorter than the TCP connect time to some upstream push services
    // (notably web.push.apple.com from networks without IPv6) and causes
    // AggregateError: ETIMEDOUT. Restoring Node 18 behaviour keeps every
    // outbound HTTPS client (web-push, Sonarr/Radarr/qBittorrent/Jellyfin,
    // Anilist, TMDB) on a single deterministic IPv4 connect.
    const net = await import('net');
    const dns = await import('dns');
    net.setDefaultAutoSelectFamily(false);
    dns.setDefaultResultOrder('ipv4first');

    const { initializeServerLogging, configureLogger } = await import('@/lib/logger');
    initializeServerLogging();

    const { getJwtSecret } = await import('@/lib/jwt-secret');
    const { registerRedisShutdownHandlers } = await import('@/lib/redis');

    getJwtSecret();
    registerRedisShutdownHandlers();

    try {
      const { ensureBootstrapAdmin } = await import('@/lib/bootstrap-admin');
      await ensureBootstrapAdmin();
    } catch (adminErr) {
      console.warn('[Helprr] Could not ensure bootstrap admin:', adminErr);
    }

    const { pollingService } = await import('@/lib/polling-service');
    const { getOrCreateAppSettings } = await import('@/lib/app-settings');
    const { configureApiLogging } = await import('@/lib/api-logger');

    try {
      const settings = await getOrCreateAppSettings();
      const { setAppTimeZone } = await import('@/lib/timezone');
      setAppTimeZone(settings.timeZone);
      const VALID_LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
      let level: 'debug' | 'info' | 'warn' | 'error' = 'info';
      if (typeof settings.logLevel === 'string' && VALID_LOG_LEVELS.has(settings.logLevel)) {
        level = settings.logLevel as 'debug' | 'info' | 'warn' | 'error';
      } else {
        console.warn(`[Helprr] Invalid logLevel "${settings.logLevel}", defaulting to "info"`);
      }
      configureLogger({
        timeZone: settings.timeZone,
        level,
        maxFileMb: settings.logMaxFileMb,
        retentionDays: settings.logRetentionDays,
        enabled: settings.logEnabled,
      });
      configureApiLogging({
        enabled: settings.logEnabled,
        failedRequestBodies: settings.logFailedRequestBodies,
        failedResponseBodies: settings.logFailedResponseBodies,
      });

      const intervalMs = settings.pollingIntervalSecs * 1000;
      const { initVapid } = await import('@/lib/notification-service');
      initVapid();
      pollingService.start(intervalMs);
      console.log('[Helprr] Polling service started');

      try {
        const { seedInitialLayouts } = await import('@/lib/dashboard-layouts');
        await seedInitialLayouts();
      } catch (seedErr) {
        console.warn('[Helprr] Could not seed dashboard layouts:', seedErr);
      }

      try {
        const { startCleanupJobs } = await import('@/lib/cleanup/scheduler');
        // Idempotent — startCleanupJobs internally restarts timers, and the
        // scheduler stashes its state on globalThis so dev hot-reload of this
        // module does not stack additional timers.
        await startCleanupJobs();
        console.log('[Helprr] Cleanup jobs started');
      } catch (cleanupErr) {
        console.warn('[Helprr] Could not start cleanup jobs:', cleanupErr);
      }
    } catch (e) {
      console.warn('[Helprr] Could not start polling service:', e);
    }
  }
}
