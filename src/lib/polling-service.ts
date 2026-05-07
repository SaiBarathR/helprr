import { prisma } from '@/lib/db';
import { getSonarrClient, getRadarrClient, getQBittorrentClient, getJellyfinClient } from '@/lib/service-helpers';
import { notifyEvent, initVapid } from '@/lib/notification-service';
import { addHours } from 'date-fns';
import crypto from 'crypto';

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function getMediaHrefFromIds(args: {
  seriesId?: unknown;
  seasonNumber?: unknown;
  episodeId?: unknown;
  movieId?: unknown;
}): string | null {
  const movieId = toNumber(args.movieId);
  if (movieId) return `/movies/${movieId}`;

  const seriesId = toNumber(args.seriesId);
  const seasonNumber = toNumber(args.seasonNumber);
  const episodeId = toNumber(args.episodeId);
  if (seriesId && seasonNumber && episodeId) {
    return `/series/${seriesId}/season/${seasonNumber}/episode/${episodeId}`;
  }
  if (seriesId && seasonNumber) {
    return `/series/${seriesId}/season/${seasonNumber}`;
  }
  if (seriesId) {
    return `/series/${seriesId}`;
  }
  return null;
}

export class PollingService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private currentIntervalMs: number | null = null;

  start(intervalMs: number): void {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error('Invalid polling interval');
    }

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
      const pollSources = [
        'pollSonarr',
        'pollRadarr',
        'pollQBittorrent',
        'pollJellyfin',
        'checkUpcoming',
      ] as const;
      const results = await Promise.allSettled([
        this.pollSonarr(),
        this.pollRadarr(),
        this.pollQBittorrent(),
        this.pollJellyfin(),
        this.checkUpcoming(),
      ]);

      const rejected = results.flatMap((result, index) => {
        if (result.status !== 'rejected') return [];
        const reason = result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
        return [{ source: pollSources[index], reason }];
      });
      if (rejected.length > 0) {
        console.error('[Polling] Failures:', rejected);
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
      const metadata = {
        source: 'sonarr' as const,
        id: item.id,
        seriesId: item.seriesId,
        seasonNumber: item.seasonNumber ?? item.episode?.seasonNumber,
        episodeId: item.episodeId ?? item.episode?.id,
      };
      const redirect = getMediaHrefFromIds(metadata) ?? '/activity?tab=queue&source=sonarr';

      if (item.trackedDownloadState === 'importFailed') {
        await notifyEvent({
          eventType: 'importFailed',
          title: 'Import Failed',
          body: `${item.title}`,
          metadata: { ...metadata, redirect },
          url: redirect,
        });
      } else if (item.trackedDownloadStatus === 'warning' || item.trackedDownloadStatus === 'error') {
        await notifyEvent({
          eventType: 'downloadFailed',
          title: 'Download Failed',
          body: `${item.title}`,
          metadata: { ...metadata, redirect },
          url: redirect,
        });
      } else {
        await notifyEvent({
          eventType: 'grabbed',
          title: 'Download Started',
          body: `${item.title}`,
          metadata: { ...metadata, redirect },
          url: redirect,
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
        const metadata = {
          source: 'sonarr' as const,
          id: item.id,
          seriesId: item.seriesId,
          seasonNumber: item.episode?.seasonNumber,
          episodeId: item.episodeId ?? item.episode?.id,
        };
        const redirect = getMediaHrefFromIds(metadata) ?? '/activity/history';

        await notifyEvent({
          eventType: 'imported',
          title: 'Episode Imported',
          body: `${item.sourceTitle}`,
          metadata: { ...metadata, redirect },
          url: redirect,
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
      const metadata = {
        source: 'radarr' as const,
        id: item.id,
        movieId: item.movieId,
      };
      const redirect = getMediaHrefFromIds(metadata) ?? '/activity?tab=queue&source=radarr';

      if (item.trackedDownloadState === 'importFailed') {
        await notifyEvent({
          eventType: 'importFailed',
          title: 'Movie Import Failed',
          body: `${item.title}`,
          metadata: { ...metadata, redirect },
          url: redirect,
        });
      } else if (item.trackedDownloadStatus === 'warning' || item.trackedDownloadStatus === 'error') {
        await notifyEvent({
          eventType: 'downloadFailed',
          title: 'Movie Download Failed',
          body: `${item.title}`,
          metadata: { ...metadata, redirect },
          url: redirect,
        });
      } else {
        await notifyEvent({
          eventType: 'grabbed',
          title: 'Movie Download Started',
          body: `${item.title}`,
          metadata: { ...metadata, redirect },
          url: redirect,
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
        const metadata = {
          source: 'radarr' as const,
          id: item.id,
          movieId: item.movieId,
        };
        const redirect = getMediaHrefFromIds(metadata) ?? '/activity/history';

        await notifyEvent({
          eventType: 'imported',
          title: 'Movie Imported',
          body: `${item.sourceTitle}`,
          metadata: { ...metadata, redirect },
          url: redirect,
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
          metadata: { source: 'qbittorrent', hash: torrent.hash, redirect: '/torrents' },
          url: '/torrents',
        });
      }

      // Detect completed (progress went from <1 to 1)
      if (torrent.progress >= 1 && prev && prev.progress < 1) {
        await notifyEvent({
          eventType: 'torrentCompleted',
          title: 'Download Complete',
          body: torrent.name,
          metadata: { source: 'qbittorrent', hash: torrent.hash, redirect: '/torrents' },
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
          metadata: { source: 'qbittorrent', hash: prev.hash, redirect: '/torrents' },
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
            metadata: { source: 'jellyfin', sessionId: session.Id, redirect: '/jellyfin' },
            url: '/jellyfin',
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
            metadata: {
              source: 'sonarr',
              seriesId: ep.seriesId,
              seasonNumber: ep.seasonNumber,
              episodeId: ep.id,
              redirect: `/series/${ep.seriesId}/season/${ep.seasonNumber}/episode/${ep.id}`,
            },
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
            metadata: {
              source: 'radarr',
              movieId: movie.id,
              redirect: `/movies/${movie.id}`,
            },
            url: `/movies/${movie.id}`,
          });
        }
      }
    } catch {}
  }
}

export const pollingService = new PollingService();
