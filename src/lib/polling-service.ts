import { prisma } from '@/lib/db';
import { getSonarrClient, getRadarrClient, getQBittorrentClient, getJellyfinClient } from '@/lib/service-helpers';
import { notifyEvent, initVapid } from '@/lib/notification-service';
import { getOrCreateAppSettings } from '@/lib/app-settings';
import { startOfLocalDay, toZonedDate } from '@/lib/timezone';
import { logger } from '@/lib/logger';
import { watchlistHrefFor } from '@/lib/watchlist-helpers';
import { addHours } from 'date-fns';
import crypto from 'crypto';

type NotificationEventInput = {
  eventType: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  url?: string;
};

type PollNotificationContext = Record<string, unknown> & {
  service: string;
  reason: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
  private isPolling = false;

  private async notifyAndLog(
    event: NotificationEventInput,
    context: PollNotificationContext
  ): Promise<number> {
    const sentCount = await notifyEvent(event);
    logger.info('Polling notification processed', {
      ...context,
      eventType: event.eventType,
      title: event.title,
      body: event.body,
      url: event.url,
      metadata: event.metadata,
      sentCount,
    }, { scope: 'polling' });
    return sentCount;
  }

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
    logger.info('Polling service starting', { intervalMs }, { scope: 'polling' });
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
      logger.info('Polling service stopped', {}, { scope: 'polling' });
    }
  }

  private async poll(): Promise<void> {
    if (this.isPolling) {
      logger.warn('Polling cycle skipped: previous cycle still running', {}, { scope: 'polling' });
      return;
    }
    this.isPolling = true;
    try {
      const startedAt = performance.now();
      const pollSources = [
        'pollSonarr',
        'pollRadarr',
        'pollQBittorrent',
        'pollJellyfin',
        'checkUpcoming',
        'checkWatchlistReminders',
      ] as const;
      logger.debug('Polling cycle started', { sources: pollSources }, { scope: 'polling' });
      const results = await Promise.allSettled([
        this.pollSonarr(),
        this.pollRadarr(),
        this.pollQBittorrent(),
        this.pollJellyfin(),
        this.checkUpcoming(),
        this.checkWatchlistReminders(),
      ]);

      const rejected = results.flatMap((result, index) => {
        if (result.status !== 'rejected') return [];
        return [{ source: pollSources[index], reason: errorMessage(result.reason) }];
      });
      const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
      logger.debug('Polling cycle completed', {
        durationMs,
        sources: results.map((result, index) => ({
          source: pollSources[index],
          status: result.status,
          reason: result.status === 'rejected' ? errorMessage(result.reason) : undefined,
        })),
        failures: rejected,
      }, { scope: 'polling' });
      if (rejected.length > 0) {
        logger.error('Polling source failures', { failures: rejected }, { scope: 'polling' });
      }
    } catch (e) {
      logger.error('Polling cycle failed', e, { scope: 'polling' });
    } finally {
      this.isPolling = false;
    }
  }

  private async pollSonarr() {
    let client;
    try {
      client = await getSonarrClient();
    } catch (error) {
      logger.debug('Skipping Sonarr poll because client is unavailable', { error }, { scope: 'polling' });
      return;
    }

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
    logger.debug('Sonarr queue polled', {
      queueCount: queue.records.length,
      previousQueueCount: prevIds.length,
      newQueueCount: newItems.length,
    }, { scope: 'polling' });

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
        await this.notifyAndLog({
          eventType: 'importFailed',
          title: 'Import Failed',
          body: `${item.title}`,
          metadata: { ...metadata, redirect },
          url: redirect,
        }, { service: 'sonarr', reason: 'queue-import-failed', itemId: item.id });
      } else if (item.trackedDownloadStatus === 'warning' || item.trackedDownloadStatus === 'error') {
        await this.notifyAndLog({
          eventType: 'downloadFailed',
          title: 'Download Failed',
          body: `${item.title}`,
          metadata: { ...metadata, redirect },
          url: redirect,
        }, { service: 'sonarr', reason: 'queue-download-failed', itemId: item.id });
      } else {
        await this.notifyAndLog({
          eventType: 'grabbed',
          title: 'Download Started',
          body: `${item.title}`,
          metadata: { ...metadata, redirect },
          url: redirect,
        }, { service: 'sonarr', reason: 'queue-new-item', itemId: item.id });
      }
    }

    // History polling
    const history = await client.getHistory(1, 50, 'date', 'descending');
    const lastDate = state.lastHistoryDate;
    const newHistory = lastDate
      ? history.records.filter((r) => new Date(r.date) > new Date(lastDate))
      : [];
    logger.debug('Sonarr history polled', {
      historyCount: history.records.length,
      lastHistoryDate: lastDate,
      newHistoryCount: newHistory.length,
    }, { scope: 'polling' });

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

        await this.notifyAndLog({
          eventType: 'imported',
          title: 'Episode Imported',
          body: `${item.sourceTitle}`,
          metadata: { ...metadata, redirect },
          url: redirect,
        }, { service: 'sonarr', reason: 'history-imported', historyId: item.id });
      }
    }

    // Health check
    const health = await client.getHealth();
    const healthHash = crypto.createHash('md5').update(JSON.stringify(health)).digest('hex');
    logger.debug('Sonarr health polled', {
      healthCount: health.length,
      changed: Boolean(state.lastHealthHash && healthHash !== state.lastHealthHash),
    }, { scope: 'polling' });
    if (state.lastHealthHash && healthHash !== state.lastHealthHash && health.length > 0) {
      await this.notifyAndLog({
        eventType: 'healthWarning',
        title: 'Sonarr Health Warning',
        body: health.map((h) => h.message).join('; ').slice(0, 200),
        url: '/settings',
      }, { service: 'sonarr', reason: 'health-changed', healthCount: health.length });
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
    logger.debug('Sonarr polling state updated', {
      queueCount: currentIds.length,
      lastHistoryDate: history.records[0]?.date ?? state.lastHistoryDate,
      healthHash,
    }, { scope: 'polling' });
  }

  private async pollRadarr() {
    let client;
    try {
      client = await getRadarrClient();
    } catch (error) {
      logger.debug('Skipping Radarr poll because client is unavailable', { error }, { scope: 'polling' });
      return;
    }

    const state = await prisma.pollingState.upsert({
      where: { serviceType: 'RADARR' },
      update: {},
      create: { serviceType: 'RADARR', lastQueueIds: [] },
    });

    const queue = await client.getQueue(1, 100);
    const currentIds = queue.records.map((r) => r.id);
    const prevIds = (state.lastQueueIds as number[]) || [];
    const newItems = queue.records.filter((r) => !prevIds.includes(r.id));
    logger.debug('Radarr queue polled', {
      queueCount: queue.records.length,
      previousQueueCount: prevIds.length,
      newQueueCount: newItems.length,
    }, { scope: 'polling' });

    for (const item of newItems) {
      const metadata = {
        source: 'radarr' as const,
        id: item.id,
        movieId: item.movieId,
      };
      const redirect = getMediaHrefFromIds(metadata) ?? '/activity?tab=queue&source=radarr';

      if (item.trackedDownloadState === 'importFailed') {
        await this.notifyAndLog({
          eventType: 'importFailed',
          title: 'Movie Import Failed',
          body: `${item.title}`,
          metadata: { ...metadata, redirect },
          url: redirect,
        }, { service: 'radarr', reason: 'queue-import-failed', itemId: item.id });
      } else if (item.trackedDownloadStatus === 'warning' || item.trackedDownloadStatus === 'error') {
        await this.notifyAndLog({
          eventType: 'downloadFailed',
          title: 'Movie Download Failed',
          body: `${item.title}`,
          metadata: { ...metadata, redirect },
          url: redirect,
        }, { service: 'radarr', reason: 'queue-download-failed', itemId: item.id });
      } else {
        await this.notifyAndLog({
          eventType: 'grabbed',
          title: 'Movie Download Started',
          body: `${item.title}`,
          metadata: { ...metadata, redirect },
          url: redirect,
        }, { service: 'radarr', reason: 'queue-new-item', itemId: item.id });
      }
    }

    const history = await client.getHistory(1, 50, 'date', 'descending');
    const lastDate = state.lastHistoryDate;
    const newHistory = lastDate
      ? history.records.filter((r) => new Date(r.date) > new Date(lastDate))
      : [];
    logger.debug('Radarr history polled', {
      historyCount: history.records.length,
      lastHistoryDate: lastDate,
      newHistoryCount: newHistory.length,
    }, { scope: 'polling' });

    for (const item of newHistory) {
      if (item.eventType === 'downloadFolderImported' || item.eventType === 'movieFileImported') {
        const metadata = {
          source: 'radarr' as const,
          id: item.id,
          movieId: item.movieId,
        };
        const redirect = getMediaHrefFromIds(metadata) ?? '/activity/history';

        await this.notifyAndLog({
          eventType: 'imported',
          title: 'Movie Imported',
          body: `${item.sourceTitle}`,
          metadata: { ...metadata, redirect },
          url: redirect,
        }, { service: 'radarr', reason: 'history-imported', historyId: item.id });
      }
    }

    const health = await client.getHealth();
    const healthHash = crypto.createHash('md5').update(JSON.stringify(health)).digest('hex');
    logger.debug('Radarr health polled', {
      healthCount: health.length,
      changed: Boolean(state.lastHealthHash && healthHash !== state.lastHealthHash),
    }, { scope: 'polling' });
    if (state.lastHealthHash && healthHash !== state.lastHealthHash && health.length > 0) {
      await this.notifyAndLog({
        eventType: 'healthWarning',
        title: 'Radarr Health Warning',
        body: health.map((h) => h.message).join('; ').slice(0, 200),
        url: '/settings',
      }, { service: 'radarr', reason: 'health-changed', healthCount: health.length });
    }

    await prisma.pollingState.update({
      where: { serviceType: 'RADARR' },
      data: {
        lastQueueIds: currentIds,
        lastHistoryDate: history.records[0]?.date ? new Date(history.records[0].date) : state.lastHistoryDate,
        lastHealthHash: healthHash,
      },
    });
    logger.debug('Radarr polling state updated', {
      queueCount: currentIds.length,
      lastHistoryDate: history.records[0]?.date ?? state.lastHistoryDate,
      healthHash,
    }, { scope: 'polling' });
  }

  private async pollQBittorrent() {
    let client;
    try {
      client = await getQBittorrentClient();
    } catch (error) {
      logger.debug('Skipping qBittorrent poll because client is unavailable', { error }, { scope: 'polling' });
      return;
    }

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
    logger.debug('qBittorrent torrents polled', {
      torrentCount: torrents.length,
      previousTorrentCount: prevEntries.length,
      newTorrentCount: torrents.filter((torrent) => !prevMap.has(torrent.hash)).length,
      deletedTorrentCount: prevEntries.filter((entry) => !currentMap.has(entry.hash)).length,
    }, { scope: 'polling' });

    // Detect new torrents (added)
    for (const torrent of torrents) {
      const prev = prevMap.get(torrent.hash);
      if (!prev) {
        await this.notifyAndLog({
          eventType: 'torrentAdded',
          title: 'Torrent Added',
          body: torrent.name,
          metadata: { source: 'qbittorrent', hash: torrent.hash, redirect: '/torrents' },
          url: '/torrents',
        }, { service: 'qbittorrent', reason: 'torrent-added', hash: torrent.hash });
      }

      // Detect completed (progress went from <1 to 1)
      if (torrent.progress >= 1 && prev && prev.progress < 1) {
        await this.notifyAndLog({
          eventType: 'torrentCompleted',
          title: 'Download Complete',
          body: torrent.name,
          metadata: { source: 'qbittorrent', hash: torrent.hash, redirect: '/torrents' },
          url: '/torrents',
        }, { service: 'qbittorrent', reason: 'torrent-completed', hash: torrent.hash });
      }
    }

    // Detect deleted (was in previous state but gone now)
    for (const prev of prevEntries) {
      if (!currentMap.has(prev.hash)) {
        await this.notifyAndLog({
          eventType: 'torrentDeleted',
          title: 'Torrent Removed',
          body: prev.name,
          metadata: { source: 'qbittorrent', hash: prev.hash, redirect: '/torrents' },
          url: '/torrents',
        }, { service: 'qbittorrent', reason: 'torrent-deleted', hash: prev.hash });
      }
    }

    // Update state
    await prisma.pollingState.update({
      where: { serviceType: 'QBITTORRENT' },
      data: {
        lastQueueIds: torrents.map((t) => ({ hash: t.hash, progress: t.progress, name: t.name })),
      },
    });
    logger.debug('qBittorrent polling state updated', {
      torrentCount: torrents.length,
    }, { scope: 'polling' });
  }

  private async pollJellyfin() {
    let client;
    try {
      client = await getJellyfinClient();
    } catch (error) {
      logger.debug('Skipping Jellyfin poll because client is unavailable', { error }, { scope: 'polling' });
      return;
    }

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
      logger.debug('Jellyfin sessions polled', {
        sessionCount: sessions.length,
        previousSessionCount: prevSessionIds.length,
        newSessionCount: newSessions.length,
      }, { scope: 'polling' });

      for (const session of newSessions) {
        const item = session.NowPlayingItem;
        if (item) {
          const title = item.SeriesName
            ? `${item.SeriesName} - ${item.Name}`
            : item.Name;
          await this.notifyAndLog({
            eventType: 'jellyfinPlaybackStart',
            title: 'Playback Started',
            body: `${session.UserName} is watching ${title}`,
            metadata: { source: 'jellyfin', sessionId: session.Id, redirect: '/jellyfin' },
            url: '/jellyfin',
          }, { service: 'jellyfin', reason: 'playback-start', sessionId: session.Id });
        }
      }

      await prisma.pollingState.update({
        where: { serviceType: 'JELLYFIN' },
        data: {
          lastQueueIds: currentSessionIds,
        },
      });
      logger.debug('Jellyfin polling state updated', {
        sessionCount: currentSessionIds.length,
      }, { scope: 'polling' });
    } catch (e) {
      logger.warn('Jellyfin session poll failed', e, { scope: 'polling' });
    }
  }

  private async checkUpcoming() {
    const settings = await getOrCreateAppSettings();
    const timeZone = settings.timeZone;

    const mode = settings.upcomingNotifyMode || 'before_air';
    const now = new Date();
    logger.debug('Upcoming poll started', {
      mode,
      timeZone,
      alertHours: settings.upcomingAlertHours,
      dailyNotifyHour: settings.upcomingDailyNotifyHour,
      notifyBeforeMins: settings.upcomingNotifyBeforeMins,
    }, { scope: 'polling' });

    // Daily digest: only run at the configured hour, once per day
    if (mode === 'daily_digest') {
      const localHour = toZonedDate(now, timeZone).getHours();
      if (localHour !== settings.upcomingDailyNotifyHour) {
        logger.debug('Skipping upcoming daily digest outside configured hour', {
          localHour,
          dailyNotifyHour: settings.upcomingDailyNotifyHour,
          timeZone,
        }, { scope: 'polling' });
        return;
      }

      const todayStart = startOfLocalDay(now, timeZone);
      const alreadySentToday = await prisma.notificationHistory.findFirst({
        where: {
          eventType: 'upcomingPremiere',
          createdAt: { gte: todayStart },
        },
      });
      if (alreadySentToday) {
        logger.debug('Skipping upcoming daily digest because one was already sent today', {
          todayStart,
          historyId: alreadySentToday.id,
        }, { scope: 'polling' });
        return;
      }
    }

    // Per-item dedupe cutoff: align with daily_digest's local-day boundary so
    // items already sent in today's digest don't slip past, and use a 24h
    // rolling window for before_air mode where the digest concept doesn't apply.
    const dedupeSince = mode === 'daily_digest'
      ? startOfLocalDay(now, timeZone)
      : new Date(Date.now() - 24 * 60 * 60 * 1000);

    const alertEnd = addHours(now, settings.upcomingAlertHours);
    const start = now.toISOString();
    const end = alertEnd.toISOString();

    // Sonarr calendar
    try {
      const client = await getSonarrClient();
      const calendar = await client.getCalendar(start, end);
      logger.debug('Sonarr upcoming calendar polled', {
        calendarCount: calendar.length,
        start,
        end,
        mode,
      }, { scope: 'polling' });
      for (const ep of calendar) {
        if (!ep.series) continue;

        // For before_air mode, only notify within the configured window before air time
        if (mode === 'before_air' && ep.airDateUtc) {
          const airTime = new Date(ep.airDateUtc);
          const minsUntilAir = (airTime.getTime() - now.getTime()) / 60000;
          if (minsUntilAir > settings.upcomingNotifyBeforeMins || minsUntilAir < 0) {
            logger.debug('Skipping Sonarr upcoming item outside before-air window', {
              seriesId: ep.seriesId,
              episodeId: ep.id,
              minsUntilAir,
              notifyBeforeMins: settings.upcomingNotifyBeforeMins,
            }, { scope: 'polling' });
            continue;
          }
        }

        const finaleLabel =
          ep.finaleType === 'series'
            ? 'Series Finale'
            : ep.finaleType === 'season'
              ? 'Season Finale'
              : ep.finaleType === 'midseason'
                ? 'Midseason Finale'
                : null;
        const baseBody = `${ep.series.title} S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')} - ${ep.title}`;
        const body = finaleLabel ? `${baseBody} (${finaleLabel})` : baseBody;
        const notificationTitle = ep.finaleType === 'series' ? 'Series Finale Airing Soon' : 'Upcoming Episode';
        const already = await prisma.notificationHistory.findFirst({
          where: {
            eventType: 'upcomingPremiere',
            body,
            createdAt: { gte: dedupeSince },
          },
        });
        if (!already) {
          await this.notifyAndLog({
            eventType: 'upcomingPremiere',
            title: notificationTitle,
            body,
            metadata: {
              source: 'sonarr',
              seriesId: ep.seriesId,
              seasonNumber: ep.seasonNumber,
              episodeId: ep.id,
              ...(ep.finaleType ? { finaleType: ep.finaleType } : {}),
              redirect: `/series/${ep.seriesId}/season/${ep.seasonNumber}/episode/${ep.id}`,
            },
            url: `/series/${ep.seriesId}`,
          }, {
            service: 'sonarr',
            reason: 'upcoming-premiere',
            seriesId: ep.seriesId,
            episodeId: ep.id,
            dedupeSince,
          });
        } else {
          logger.debug('Skipping duplicate Sonarr upcoming notification', {
            seriesId: ep.seriesId,
            episodeId: ep.id,
            dedupeSince,
            historyId: already.id,
          }, { scope: 'polling' });
        }
      }
    } catch (error) {
      logger.warn('Sonarr upcoming calendar poll failed', error, { scope: 'polling' });
    }

    // Radarr calendar
    try {
      const client = await getRadarrClient();
      const calendar = await client.getCalendar(start, end);
      logger.debug('Radarr upcoming calendar polled', {
        calendarCount: calendar.length,
        start,
        end,
        mode,
      }, { scope: 'polling' });
      const releaseTypeLabels = {
        cinema: 'In Cinemas',
        physical: 'Physical Release',
        digital: 'Digital Release',
      } as const;
      for (const movie of calendar) {
        const releases: Array<['cinema' | 'physical' | 'digital', string | undefined]> = [
          ['cinema', movie.inCinemas],
          ['physical', movie.physicalRelease],
          ['digital', movie.digitalRelease],
        ];
        for (const [releaseType, dateStr] of releases) {
          if (!dateStr) continue;
          const airTime = new Date(dateStr);
          if (!Number.isFinite(airTime.getTime())) continue;

          if (mode === 'before_air') {
            const minsUntilAir = (airTime.getTime() - now.getTime()) / 60000;
            if (minsUntilAir > settings.upcomingNotifyBeforeMins || minsUntilAir < 0) {
              logger.debug('Skipping Radarr upcoming item outside before-air window', {
                movieId: movie.id,
                releaseType,
                minsUntilAir,
                notifyBeforeMins: settings.upcomingNotifyBeforeMins,
              }, { scope: 'polling' });
              continue;
            }
          }

          const body = `${movie.title} (${movie.year}) — ${releaseTypeLabels[releaseType]}`;
          const already = await prisma.notificationHistory.findFirst({
            where: {
              eventType: 'upcomingPremiere',
              body,
              createdAt: { gte: dedupeSince },
            },
          });
          if (!already) {
            await this.notifyAndLog({
              eventType: 'upcomingPremiere',
              title: 'Upcoming Movie',
              body,
              metadata: {
                source: 'radarr',
                movieId: movie.id,
                releaseType,
                redirect: `/movies/${movie.id}`,
              },
              url: `/movies/${movie.id}`,
            }, {
              service: 'radarr',
              reason: 'upcoming-premiere',
              movieId: movie.id,
              releaseType,
              dedupeSince,
            });
          } else {
            logger.debug('Skipping duplicate Radarr upcoming notification', {
              movieId: movie.id,
              releaseType,
              dedupeSince,
              historyId: already.id,
            }, { scope: 'polling' });
          }
        }
      }
    } catch (error) {
      logger.warn('Radarr upcoming calendar poll failed', error, { scope: 'polling' });
    }
  }

  private async checkWatchlistReminders(): Promise<void> {
    const now = new Date();
    const due = await prisma.watchlistItem.findMany({
      where: {
        reminderAt: { lte: now },
        reminderNotifiedAt: null,
      },
      take: 50,
    });
    if (due.length === 0) return;
    logger.debug('Watchlist reminders due', { count: due.length }, { scope: 'polling' });

    for (const item of due) {
      const yearSuffix = item.year ? ` (${item.year})` : '';
      const body = `${item.title}${yearSuffix}`;
      const redirect = watchlistHrefFor(item.source, item.externalId, item.mediaType) ?? '/watchlist';
      try {
        await this.notifyAndLog({
          eventType: 'watchlistReminder',
          title: 'Watchlist Reminder',
          body,
          metadata: {
            source: 'watchlist',
            id: item.id,
            redirect,
          },
          url: redirect,
        }, { service: 'watchlist', reason: 'reminder-due', itemId: item.id });
      } finally {
        // Mark notified even on push failure so we don't spam every poll cycle.
        await prisma.watchlistItem.update({
          where: { id: item.id },
          data: { reminderNotifiedAt: now },
        }).catch((error) => {
          logger.warn('Failed to mark watchlist reminder as notified', { itemId: item.id, error }, { scope: 'polling' });
        });
      }
    }
  }
}


export const pollingService = new PollingService();
