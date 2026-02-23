export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET env var is required');
    }

    const { pollingService } = await import('@/lib/polling-service');
    const { prisma } = await import('@/lib/db');

    try {
      const settings = await prisma.appSettings.upsert({
        where: { id: 'singleton' },
        update: {},
        create: {},
      });

      const intervalMs = settings.pollingIntervalSecs * 1000;
      pollingService.start(intervalMs);
      console.log('[Helprr] Polling service started');
    } catch (e) {
      console.warn('[Helprr] Could not start polling service:', e);
    }
  }
}
