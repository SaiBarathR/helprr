import { prisma } from '@/lib/db';
import { getSonarrClient, getRadarrClient } from '@/lib/service-helpers';
import { notifyEvent, initVapid } from '@/lib/notification-service';
import { addHours } from 'date-fns';
import crypto from 'crypto';

export class PollingService {
  private intervalId: ReturnType<typeof setInterval> | null = null;

  start(intervalMs: number) {
    if (this.intervalId) return;
    initVapid();
    console.log(`[Polling] Starting with interval ${intervalMs}ms`);
    this.intervalId = setInterval(() => this.poll(), intervalMs);
    this.poll();
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[Polling] Stopped');
    }
  }

  private async poll() {
    try {
      await Promise.allSettled([
        this.pollSonarr(),
        this.pollRadarr(),
        this.checkUpcoming(),
      ]);
    } catch (e) {
      console.error('[Polling] Error:', e);
    }
  }

  private async pollSonarr() {
    let client;
    try { client = await getSonarrClient(); } catch { return; }

    const state = await prisma.pollingState.upsert({
      where: { serviceType: 'SONARR' },
      update: {},
      create: { serviceType: 'SONARR', lastQueueIds: [] },
    });

    // Queue polling
    const queue = await client.getQueue(1, 100);
    const currentIds = queue.records.map((r) => r.id);
    const prevIds = (state.lastQueueIds as number[]) || [];
    const newItems = queue.records.filter((r) => !prevIds.includes(r.id));

    for (const item of newItems) {
      if (item.trackedDownloadState === 'importFailed') {
        await notifyEvent({
          eventType: 'importFailed',
          title: 'Import Failed',
          body: `${item.title}`,
          metadata: { source: 'sonarr', id: item.id },
          url: '/activity',
        });
      } else if (item.trackedDownloadStatus === 'warning' || item.trackedDownloadStatus === 'error') {
        await notifyEvent({
          eventType: 'downloadFailed',
          title: 'Download Failed',
          body: `${item.title}`,
          metadata: { source: 'sonarr', id: item.id },
          url: '/activity',
        });
      } else {
        await notifyEvent({
          eventType: 'grabbed',
          title: 'Download Started',
          body: `${item.title}`,
          metadata: { source: 'sonarr', id: item.id },
          url: '/activity',
        });
      }
    }

    // History polling
    const history = await client.getHistory(1, 50, 'date', 'descending');
    const lastDate = state.lastHistoryDate;
    const newHistory = lastDate
      ? history.records.filter((r) => new Date(r.date) > new Date(lastDate))
      : [];

    for (const item of newHistory) {
      if (item.eventType === 'downloadFolderImported' || item.eventType === 'episodeFileImported') {
        await notifyEvent({
          eventType: 'imported',
          title: 'Episode Imported',
          body: `${item.sourceTitle}`,
          metadata: { source: 'sonarr', id: item.id },
          url: item.seriesId ? `/series/${item.seriesId}` : '/activity',
        });
      }
    }

    // Health check
    const health = await client.getHealth();
    const healthHash = crypto.createHash('md5').update(JSON.stringify(health)).digest('hex');
    if (state.lastHealthHash && healthHash !== state.lastHealthHash && health.length > 0) {
      await notifyEvent({
        eventType: 'healthWarning',
        title: 'Sonarr Health Warning',
        body: health.map((h) => h.message).join('; ').slice(0, 200),
        url: '/settings',
      });
    }

    // Update state
    await prisma.pollingState.update({
      where: { serviceType: 'SONARR' },
      data: {
        lastQueueIds: currentIds,
        lastHistoryDate: history.records[0]?.date ? new Date(history.records[0].date) : state.lastHistoryDate,
        lastHealthHash: healthHash,
      },
    });
  }

  private async pollRadarr() {
    let client;
    try { client = await getRadarrClient(); } catch { return; }

    const state = await prisma.pollingState.upsert({
      where: { serviceType: 'RADARR' },
      update: {},
      create: { serviceType: 'RADARR', lastQueueIds: [] },
    });

    const queue = await client.getQueue(1, 100);
    const currentIds = queue.records.map((r) => r.id);
    const prevIds = (state.lastQueueIds as number[]) || [];
    const newItems = queue.records.filter((r) => !prevIds.includes(r.id));

    for (const item of newItems) {
      if (item.trackedDownloadState === 'importFailed') {
        await notifyEvent({
          eventType: 'importFailed',
          title: 'Movie Import Failed',
          body: `${item.title}`,
          metadata: { source: 'radarr', id: item.id },
          url: '/activity',
        });
      } else if (item.trackedDownloadStatus === 'warning' || item.trackedDownloadStatus === 'error') {
        await notifyEvent({
          eventType: 'downloadFailed',
          title: 'Movie Download Failed',
          body: `${item.title}`,
          metadata: { source: 'radarr', id: item.id },
          url: '/activity',
        });
      } else {
        await notifyEvent({
          eventType: 'grabbed',
          title: 'Movie Download Started',
          body: `${item.title}`,
          metadata: { source: 'radarr', id: item.id },
          url: '/activity',
        });
      }
    }

    const history = await client.getHistory(1, 50, 'date', 'descending');
    const lastDate = state.lastHistoryDate;
    const newHistory = lastDate
      ? history.records.filter((r) => new Date(r.date) > new Date(lastDate))
      : [];

    for (const item of newHistory) {
      if (item.eventType === 'downloadFolderImported' || item.eventType === 'movieFileImported') {
        await notifyEvent({
          eventType: 'imported',
          title: 'Movie Imported',
          body: `${item.sourceTitle}`,
          metadata: { source: 'radarr', id: item.id },
          url: item.movieId ? `/movies/${item.movieId}` : '/activity',
        });
      }
    }

    const health = await client.getHealth();
    const healthHash = crypto.createHash('md5').update(JSON.stringify(health)).digest('hex');
    if (state.lastHealthHash && healthHash !== state.lastHealthHash && health.length > 0) {
      await notifyEvent({
        eventType: 'healthWarning',
        title: 'Radarr Health Warning',
        body: health.map((h) => h.message).join('; ').slice(0, 200),
        url: '/settings',
      });
    }

    await prisma.pollingState.update({
      where: { serviceType: 'RADARR' },
      data: {
        lastQueueIds: currentIds,
        lastHistoryDate: history.records[0]?.date ? new Date(history.records[0].date) : state.lastHistoryDate,
        lastHealthHash: healthHash,
      },
    });
  }

  private async checkUpcoming() {
    const settings = await prisma.appSettings.upsert({
      where: { id: 'singleton' },
      update: {},
      create: {},
    });

    const now = new Date();
    const alertEnd = addHours(now, settings.upcomingAlertHours);
    const start = now.toISOString();
    const end = alertEnd.toISOString();

    // Sonarr calendar
    try {
      const client = await getSonarrClient();
      const calendar = await client.getCalendar(start, end);
      for (const ep of calendar) {
        const already = await prisma.notificationHistory.findFirst({
          where: {
            eventType: 'upcomingPremiere',
            title: { contains: ep.series?.title || '' },
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
        });
        if (!already && ep.series) {
          await notifyEvent({
            eventType: 'upcomingPremiere',
            title: 'Upcoming Episode',
            body: `${ep.series.title} S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')} - ${ep.title}`,
            url: `/series/${ep.seriesId}`,
          });
        }
      }
    } catch {}

    // Radarr calendar
    try {
      const client = await getRadarrClient();
      const calendar = await client.getCalendar(start, end);
      for (const movie of calendar) {
        const already = await prisma.notificationHistory.findFirst({
          where: {
            eventType: 'upcomingPremiere',
            title: { contains: movie.title },
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
        });
        if (!already) {
          await notifyEvent({
            eventType: 'upcomingPremiere',
            title: 'Upcoming Movie',
            body: `${movie.title} (${movie.year})`,
            url: `/movies/${movie.id}`,
          });
        }
      }
    } catch {}
  }
}

export const pollingService = new PollingService();
