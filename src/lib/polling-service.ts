import { prisma } from '@/lib/db';
import { getSonarrClient, getRadarrClient, getQBittorrentClient, getJellyfinClient } from '@/lib/service-helpers';
import { notifyEvent, initVapid } from '@/lib/notification-service';
import { addHours } from 'date-fns';
import crypto from 'crypto';

export class PollingService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private currentIntervalMs: number | null = null;

  start(intervalMs: number): void {
    if (this.intervalId) {
      if (this.currentIntervalMs !== intervalMs) {
        this.restart(intervalMs);
      }
      return;
    }
    initVapid();
    console.log(`[Polling] Starting with interval ${intervalMs}ms`);
    this.currentIntervalMs = intervalMs;
    this.intervalId = setInterval(() => void this.poll(), intervalMs);
    void this.poll();
  }

  restart(intervalMs: number): void {
    this.stop();
    this.start(intervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.currentIntervalMs = null;
      console.log('[Polling] Stopped');
    }
  }

  private async poll(): Promise<void> {
    try {
      const results = await Promise.allSettled([
        this.pollSonarr(),
        this.pollRadarr(),
        this.pollQBittorrent(),
        this.pollJellyfin(),
        this.checkUpcoming(),
      ]);

      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      );
      if (rejected.length > 0) {
        console.error('[Polling] Failures:', rejected.map((result) => result.reason));
      }
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

  private async pollQBittorrent() {
    let client;
    try { client = await getQBittorrentClient(); } catch { return; }

    const state = await prisma.pollingState.upsert({
      where: { serviceType: 'QBITTORRENT' },
      update: {},
      create: { serviceType: 'QBITTORRENT', lastQueueIds: [] },
    });

    const torrents = await client.getTorrents();
    const currentMap = new Map(torrents.map((t) => [t.hash, t]));

    // Previous state: array of {hash, progress, name}
    const prevEntries = (state.lastQueueIds as { hash: string; progress: number; name: string }[]) || [];
    const prevMap = new Map(prevEntries.map((e) => [e.hash, e]));

    // Detect new torrents (added)
    for (const torrent of torrents) {
      const prev = prevMap.get(torrent.hash);
      if (!prev) {
        await notifyEvent({
          eventType: 'torrentAdded',
          title: 'Torrent Added',
          body: torrent.name,
          metadata: { source: 'qbittorrent', hash: torrent.hash },
          url: '/torrents',
        });
      }

      // Detect completed (progress went from <1 to 1)
      if (torrent.progress >= 1 && prev && prev.progress < 1) {
        await notifyEvent({
          eventType: 'torrentCompleted',
          title: 'Download Complete',
          body: torrent.name,
          metadata: { source: 'qbittorrent', hash: torrent.hash },
          url: '/torrents',
        });
      }
    }

    // Detect deleted (was in previous state but gone now)
    for (const prev of prevEntries) {
      if (!currentMap.has(prev.hash)) {
        await notifyEvent({
          eventType: 'torrentDeleted',
          title: 'Torrent Removed',
          body: prev.name,
          metadata: { source: 'qbittorrent', hash: prev.hash },
          url: '/torrents',
        });
      }
    }

    // Update state
    await prisma.pollingState.update({
      where: { serviceType: 'QBITTORRENT' },
      data: {
        lastQueueIds: torrents.map((t) => ({ hash: t.hash, progress: t.progress, name: t.name })),
      },
    });
  }

  private async pollJellyfin() {
    let client;
    try { client = await getJellyfinClient(); } catch { return; }

    const state = await prisma.pollingState.upsert({
      where: { serviceType: 'JELLYFIN' },
      update: {},
      create: { serviceType: 'JELLYFIN', lastQueueIds: [] },
    });

    // Activity log polling (new library items)
    try {
      const minDate = state.lastHistoryDate?.toISOString();
      const activity = await client.getActivityLog({ limit: 50, minDate });
      const lastDate = state.lastHistoryDate;
      const newEntries = lastDate
        ? activity.Items.filter((a) => new Date(a.Date) > new Date(lastDate))
        : [];

      for (const entry of newEntries) {
        if (entry.Type === 'ItemAdded' || entry.Name.includes('added to library')) {
          await notifyEvent({
            eventType: 'jellyfinItemAdded',
            title: 'Media Added to Jellyfin',
            body: entry.Overview || entry.Name,
            metadata: { source: 'jellyfin', id: entry.Id },
            url: '/dashboard',
          });
        }
      }

      const latestDate = activity.Items.length > 0
        ? new Date(activity.Items[0].Date)
        : state.lastHistoryDate;

      await prisma.pollingState.update({
        where: { serviceType: 'JELLYFIN' },
        data: {
          lastHistoryDate: latestDate,
        },
      });
    } catch (e) {
      console.error('[Polling] Jellyfin activity error:', e);
    }

    // Session polling (new playback)
    try {
      const sessions = await client.getActiveSessions();
      const currentSessionIds = sessions.map((s) => s.Id);
      const prevSessionIds = (state.lastQueueIds as string[]) || [];

      const newSessions = sessions.filter((s) => !prevSessionIds.includes(s.Id));

      for (const session of newSessions) {
        const item = session.NowPlayingItem;
        if (item) {
          const title = item.SeriesName
            ? `${item.SeriesName} - ${item.Name}`
            : item.Name;
          await notifyEvent({
            eventType: 'jellyfinPlaybackStart',
            title: 'Playback Started',
            body: `${session.UserName} is watching ${title}`,
            metadata: { source: 'jellyfin', sessionId: session.Id },
            url: '/dashboard',
          });
        }
      }

      await prisma.pollingState.update({
        where: { serviceType: 'JELLYFIN' },
        data: {
          lastQueueIds: currentSessionIds,
        },
      });
    } catch (e) {
      console.error('[Polling] Jellyfin sessions error:', e);
    }
  }

  private async checkUpcoming() {
    const settings = await prisma.appSettings.upsert({
      where: { id: 'singleton' },
      update: {},
      create: {},
    });

    const mode = settings.upcomingNotifyMode || 'before_air';

    // Daily digest: only run at the configured hour, once per day
    if (mode === 'daily_digest') {
      const now = new Date();
      if (now.getHours() !== settings.upcomingDailyNotifyHour) return;

      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const alreadySentToday = await prisma.notificationHistory.findFirst({
        where: {
          eventType: 'upcomingPremiere',
          createdAt: { gte: todayStart },
        },
      });
      if (alreadySentToday) return;
    }

    const now = new Date();
    const alertEnd = addHours(now, settings.upcomingAlertHours);
    const start = now.toISOString();
    const end = alertEnd.toISOString();

    // Sonarr calendar
    try {
      const client = await getSonarrClient();
      const calendar = await client.getCalendar(start, end);
      for (const ep of calendar) {
        if (!ep.series) continue;

        // For before_air mode, only notify within the configured window before air time
        if (mode === 'before_air' && ep.airDateUtc) {
          const airTime = new Date(ep.airDateUtc);
          const minsUntilAir = (airTime.getTime() - now.getTime()) / 60000;
          if (minsUntilAir > settings.upcomingNotifyBeforeMins || minsUntilAir < 0) continue;
        }

        const body = `${ep.series.title} S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')} - ${ep.title}`;
        const already = await prisma.notificationHistory.findFirst({
          where: {
            eventType: 'upcomingPremiere',
            body,
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
        });
        if (!already) {
          await notifyEvent({
            eventType: 'upcomingPremiere',
            title: 'Upcoming Episode',
            body,
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
        if (mode === 'before_air') {
          const releaseDate = movie.digitalRelease || movie.physicalRelease || movie.inCinemas;
          if (releaseDate) {
            const airTime = new Date(releaseDate);
            const minsUntilAir = (airTime.getTime() - now.getTime()) / 60000;
            if (minsUntilAir > settings.upcomingNotifyBeforeMins || minsUntilAir < 0) continue;
          }
        }

        const body = `${movie.title} (${movie.year})`;
        const already = await prisma.notificationHistory.findFirst({
          where: {
            eventType: 'upcomingPremiere',
            body,
            createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
        });
        if (!already) {
          await notifyEvent({
            eventType: 'upcomingPremiere',
            title: 'Upcoming Movie',
            body,
            url: `/movies/${movie.id}`,
          });
        }
      }
    } catch {}
  }
}

export const pollingService = new PollingService();
