import { prisma } from '@/lib/db';
import { getSonarrClient, getRadarrClient, getQBittorrentClient, getJellyfinClient } from '@/lib/service-helpers';
import { notifyEvent, initVapid } from '@/lib/notification-service';
import { addHours } from 'date-fns';
import crypto from 'crypto';

export class PollingService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private currentIntervalMs: number | null = null;

  private normalizeValue(value: unknown): string {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
  }

  private normalizeState(value: unknown): string {
    return this.normalizeValue(value).replace(/[^a-z0-9]/g, '');
  }

  private isImportFailedState(value: unknown): boolean {
    return this.normalizeState(value) === 'importfailed';
  }

  private isFailedDownloadStatus(value: unknown): boolean {
    const status = this.normalizeValue(value);
    return status === 'warning' || status === 'error' || status === 'failed';
  }

  private parseQueueSnapshots(raw: unknown): Map<number, {
    id: number;
    trackedDownloadState?: string;
    trackedDownloadStatus?: string;
  }> {
    if (!Array.isArray(raw)) return new Map();

    const entries = raw.flatMap((entry) => {
      if (typeof entry === 'number' && Number.isFinite(entry)) {
        return [{ id: entry }];
      }
      if (
        entry
        && typeof entry === 'object'
        && 'id' in entry
        && typeof entry.id === 'number'
        && Number.isFinite(entry.id)
      ) {
        const obj = entry as {
          id: number;
          trackedDownloadState?: unknown;
          trackedDownloadStatus?: unknown;
        };
        return [{
          id: obj.id,
          trackedDownloadState: typeof obj.trackedDownloadState === 'string' ? obj.trackedDownloadState : undefined,
          trackedDownloadStatus: typeof obj.trackedDownloadStatus === 'string' ? obj.trackedDownloadStatus : undefined,
        }];
      }
      return [];
    });

    return new Map(entries.map((entry) => [entry.id, entry]));
  }

  private parseJellyfinPollingState(raw: unknown): { sessionIds: string[]; recentItemIds: string[] } {
    const parseStringArray = (value: unknown): string[] => {
      if (!Array.isArray(value)) return [];
      return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
    };

    // Legacy shape (array of session ids).
    if (Array.isArray(raw)) {
      return {
        sessionIds: parseStringArray(raw),
        recentItemIds: [],
      };
    }

    if (!raw || typeof raw !== 'object') {
      return {
        sessionIds: [],
        recentItemIds: [],
      };
    }

    const value = raw as { sessionIds?: unknown; recentItemIds?: unknown };
    return {
      sessionIds: parseStringArray(value.sessionIds),
      recentItemIds: parseStringArray(value.recentItemIds),
    };
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
    const previousQueue = this.parseQueueSnapshots(state.lastQueueIds);

    for (const item of queue.records) {
      const previousItem = previousQueue.get(item.id);
      const isImportFailedNow = this.isImportFailedState(item.trackedDownloadState);
      const wasImportFailed = this.isImportFailedState(previousItem?.trackedDownloadState);
      const isDownloadFailedNow = this.isFailedDownloadStatus(item.trackedDownloadStatus);
      const wasDownloadFailed = this.isFailedDownloadStatus(previousItem?.trackedDownloadStatus);

      if (isImportFailedNow && !wasImportFailed) {
        await notifyEvent({
          eventType: 'importFailed',
          title: 'Import Failed',
          body: `${item.title}`,
          metadata: { source: 'sonarr', id: item.id },
          url: '/activity',
        });
      } else if (!isImportFailedNow && isDownloadFailedNow && !wasDownloadFailed) {
        await notifyEvent({
          eventType: 'downloadFailed',
          title: 'Download Failed',
          body: `${item.title}`,
          metadata: { source: 'sonarr', id: item.id },
          url: '/activity',
        });
      } else if (!previousItem && !isImportFailedNow && !isDownloadFailedNow) {
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
        lastQueueIds: queue.records.map((item) => ({
          id: item.id,
          trackedDownloadState: item.trackedDownloadState,
          trackedDownloadStatus: item.trackedDownloadStatus,
        })),
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
    const previousQueue = this.parseQueueSnapshots(state.lastQueueIds);

    for (const item of queue.records) {
      const previousItem = previousQueue.get(item.id);
      const isImportFailedNow = this.isImportFailedState(item.trackedDownloadState);
      const wasImportFailed = this.isImportFailedState(previousItem?.trackedDownloadState);
      const isDownloadFailedNow = this.isFailedDownloadStatus(item.trackedDownloadStatus);
      const wasDownloadFailed = this.isFailedDownloadStatus(previousItem?.trackedDownloadStatus);

      if (isImportFailedNow && !wasImportFailed) {
        await notifyEvent({
          eventType: 'importFailed',
          title: 'Movie Import Failed',
          body: `${item.title}`,
          metadata: { source: 'radarr', id: item.id },
          url: '/activity',
        });
      } else if (!isImportFailedNow && isDownloadFailedNow && !wasDownloadFailed) {
        await notifyEvent({
          eventType: 'downloadFailed',
          title: 'Movie Download Failed',
          body: `${item.title}`,
          metadata: { source: 'radarr', id: item.id },
          url: '/activity',
        });
      } else if (!previousItem && !isImportFailedNow && !isDownloadFailedNow) {
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
        lastQueueIds: queue.records.map((item) => ({
          id: item.id,
          trackedDownloadState: item.trackedDownloadState,
          trackedDownloadStatus: item.trackedDownloadStatus,
        })),
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

    const jellyfinState = this.parseJellyfinPollingState(state.lastQueueIds);
    let nextSessionIds = jellyfinState.sessionIds;
    let nextRecentItemIds = jellyfinState.recentItemIds;
    let nextHistoryDate = state.lastHistoryDate;

    // Recently added polling (new library items)
    try {
      const recentlyAdded = await client.getRecentlyAdded({ limit: 50 });
      const currentRecentItemIds = recentlyAdded
        .map((item) => item.Id)
        .filter((itemId): itemId is string => typeof itemId === 'string' && itemId.length > 0);
      const previousRecentItemIds = new Set(jellyfinState.recentItemIds);
      const shouldNotify = jellyfinState.recentItemIds.length > 0;

      if (shouldNotify) {
        for (const item of recentlyAdded) {
          const itemId = item.Id;
          if (!itemId || previousRecentItemIds.has(itemId)) continue;

          await notifyEvent({
            eventType: 'jellyfinItemAdded',
            title: 'Media Added to Jellyfin',
            body: item.Overview || item.Name,
            metadata: { source: 'jellyfin', id: itemId },
            url: '/dashboard',
          });
        }
      }

      nextRecentItemIds = currentRecentItemIds;
      const mostRecentCreatedAt = recentlyAdded.reduce<Date | null>((latest, item) => {
        if (!item.DateCreated) return latest;
        const date = new Date(item.DateCreated);
        if (Number.isNaN(date.getTime())) return latest;
        if (!latest || date > latest) return date;
        return latest;
      }, null);
      if (mostRecentCreatedAt) nextHistoryDate = mostRecentCreatedAt;
    } catch (e) {
      console.error('[Polling] Jellyfin recently-added error:', e);
    }

    // Session polling (new playback)
    try {
      const sessions = await client.getActiveSessions();
      const currentSessionIds = sessions.map((s) => s.Id);
      const previousSessionIds = new Set(jellyfinState.sessionIds);

      const newSessions = sessions.filter((s) => !previousSessionIds.has(s.Id));

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

      nextSessionIds = currentSessionIds;
    } catch (e) {
      console.error('[Polling] Jellyfin sessions error:', e);
    }

    await prisma.pollingState.update({
      where: { serviceType: 'JELLYFIN' },
      data: {
        lastQueueIds: {
          sessionIds: nextSessionIds,
          recentItemIds: nextRecentItemIds,
        },
        lastHistoryDate: nextHistoryDate,
      },
    });
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
