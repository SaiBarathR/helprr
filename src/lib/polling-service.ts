import { prisma } from '@/lib/db';
import { getSonarrClient, getRadarrClient, getLidarrClient, getQBittorrentClient, getJellyfinClient, getSeerrClient } from '@/lib/service-helpers';
import { SEERR_MEDIA_STATUS, SEERR_REQUEST_STATUS } from '@/types/seerr';
import { getCachedSeerrMediaDetail, formatSeerrMediaLabel } from '@/lib/seerr-helpers';
import { notifyEvent, initVapid } from '@/lib/notification-service';
import { getOrCreateAppSettings } from '@/lib/app-settings';
import { ensureSeriesAniListMapping } from '@/lib/anilist-series-mapping';
import { AniListRateLimitError } from '@/lib/anilist-client';
import { startOfLocalDay, endOfLocalDay, toZonedDate, dateInTimeZone, getLocalDateKey } from '@/lib/timezone';
import { buildActivityDigest, type ActivityDigestPeriod } from '@/lib/digests/build-activity-digest';
import { parseBandwidthSchedule } from '@/lib/bandwidth-scheduler/parse';
import { pickActiveRule } from '@/lib/bandwidth-scheduler/active-rule';
import { logger } from '@/lib/logger';
import { watchlistHrefFor } from '@/lib/watchlist-helpers';
import { getLibraryLookups, isItemInLibrary } from '@/lib/watchlist-library-lookup';
import { classifyQueueIssue } from '@/lib/queue-state';
import { writeBadgeSlice } from '@/lib/cache/badge-counts';
import type { QueueItem, QueueResponse, SonarrSeries } from '@/types';
import crypto from 'crypto';

// Tolerance (minutes) for the "before_air" firing window. Lets a sluggish poll
// still catch an item that just slipped past its computed notify time —
// important for the "0 min / at air time" case, where the notify moment is
// the air moment itself.
const BEFORE_AIR_GRACE_MIN = 5;
// Extra calendar fetch padding past notifyBeforeMins so an item near the upper
// edge isn't excluded by clock skew between us and Sonarr/Radarr.
const FETCH_END_BUFFER_MS = 60_000;

const MAX_REMINDER_ATTEMPTS = 3;

function firstStatusMessage(item: QueueItem): string | null {
  const messages = item.statusMessages;
  if (!messages || messages.length === 0) return null;
  for (const group of messages) {
    const first = group.messages?.find((m) => m && m.trim().length > 0);
    if (first) return first.trim();
  }
  return null;
}

function importFailureBody(item: QueueItem): string {
  const reason = firstStatusMessage(item) ?? item.errorMessage?.trim() ?? '';
  return reason ? `${item.title} — ${reason}` : item.title;
}

function downloadFailureBody(item: QueueItem): string {
  const reason = item.errorMessage?.trim() || firstStatusMessage(item) || '';
  return reason ? `${item.title} — ${reason}` : item.title;
}

type QueueSnapshot = { id: number; state: string; status: string };

type AnimeAutoMapRun = {
  startedAt: number;
  stop: boolean;
  processed: number;
  failed: number;
  queueTotal: number;
  currentTitle: string | null;
};

function readQueueSnapshots(raw: unknown): Map<number, QueueSnapshot | 'legacy'> {
  const map = new Map<number, QueueSnapshot | 'legacy'>();
  if (!Array.isArray(raw)) return map;
  for (const entry of raw) {
    // Legacy shape was bare numbers; we know the id existed last cycle but
    // can't tell what state it was in, so we can't fire transition events for
    // it. Treat as a sentinel so we don't double-fire a "new item" notification
    // for an item that was actually known.
    if (typeof entry === 'number') {
      map.set(entry, 'legacy');
      continue;
    }
    if (entry && typeof entry === 'object') {
      const e = entry as Partial<QueueSnapshot>;
      if (typeof e.id === 'number') {
        map.set(e.id, {
          id: e.id,
          state: typeof e.state === 'string' ? e.state : '',
          status: typeof e.status === 'string' ? e.status : '',
        });
      }
    }
  }
  return map;
}

// Fetch the entire queue across pages. The *arr queue endpoint paginates, and a
// single page misses everything past it — failed items beyond page 1 would never
// notify, and old items would look "new" when they finally scroll onto page 1.
// We page until we've collected totalRecords, with a safety cap on runaway queues.
async function fetchAllQueueRecords(client: {
  getQueue: (page: number, pageSize: number) => Promise<QueueResponse>;
}): Promise<QueueResponse> {
  const pageSize = 200;
  const maxPages = 50; // ~10k items; bounds a pathological queue
  const first = await client.getQueue(1, pageSize);
  const records = [...first.records];
  for (let page = 2; records.length < first.totalRecords && page <= maxPages; page++) {
    const next = await client.getQueue(page, pageSize);
    if (next.records.length === 0) break;
    records.push(...next.records);
  }
  if (records.length < first.totalRecords) {
    logger.warn(
      'Queue pagination capped',
      { collected: records.length, totalRecords: first.totalRecords },
      { scope: 'polling' },
    );
  }
  return { ...first, records, totalRecords: first.totalRecords };
}

type NotificationEventInput = {
  eventType: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  url?: string;
  dedupeKey?: string;
  userIds?: string[];
  ownerUserId?: string | null;
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
  albumId?: unknown;
  artistId?: unknown;
}): string | null {
  const movieId = toNumber(args.movieId);
  if (movieId) return `/movies/${movieId}`;

  const albumId = toNumber(args.albumId);
  if (albumId) return `/music/album/${albumId}`;
  const artistId = toNumber(args.artistId);
  if (artistId) return `/music/${artistId}`;

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
  // Epoch ms of the last NotificationHistory retention sweep. The poll loop runs
  // every ~30s but the sweep is throttled to once/day; 0 = run on first cycle.
  private lastNotificationPruneAt = 0;
  // Tracks the bandwidth-schedule rule (and limits) we last pushed to
  // qBittorrent so we only re-send on actual changes. Process-restart loses
  // this — the next cycle will re-apply once (idempotent).
  private appliedBandwidth: {
    ruleId: string;
    downloadKbps: number;
    uploadKbps: number;
  } | null = null;
  // Nightly anime auto-map run. The whole run lives in this one in-memory
  // object so status can report real progress; a restart drops it on purpose —
  // the scheduled gate re-triggers (lastRunAt was never stamped) and the
  // rebuilt queue skips everything that already got a row. animeMapWake lets
  // Stop cut the loop's sleeps short. In dev, HMR can transiently double the
  // loop; the per-item row re-check bounds that to redundant idempotent work.
  private animeMapRun: AnimeAutoMapRun | null = null;
  private animeMapWake: (() => void) | null = null;

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
        'pollLidarr',
        'pollQBittorrent',
        'pollJellyfin',
        'pollSeerr',
        'checkUpcoming',
        'checkWatchlistReminders',
        'checkActivityDigest',
        'applyBandwidthSchedule',
        'checkNotificationRetention',
        'checkAnimeAutoMap',
      ] as const;
      logger.debug('Polling cycle started', { sources: pollSources }, { scope: 'polling' });
      const results = await Promise.allSettled([
        this.pollSonarr(),
        this.pollRadarr(),
        this.pollLidarr(),
        this.pollQBittorrent(),
        this.pollJellyfin(),
        this.pollSeerr(),
        this.checkUpcoming(),
        this.checkWatchlistReminders(),
        this.checkActivityDigest(),
        this.applyBandwidthSchedule(),
        this.checkNotificationRetention(),
        this.checkAnimeAutoMap(),
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

  /** Snapshot of the in-flight auto-map run for the status endpoint. */
  getAnimeAutoMapState(): {
    running: boolean;
    run: { processed: number; queueTotal: number; failed: number; currentTitle: string | null } | null;
  } {
    const run = this.animeMapRun;
    return {
      running: run !== null,
      run: run
        ? {
            processed: run.processed,
            queueTotal: run.queueTotal,
            failed: run.failed,
            currentTitle: run.currentTitle,
          }
        : null,
    };
  }

  /**
   * Signal the run loop to stop after the current item; the loop's exit path
   * stamps "done today". Returns false (and stamps nothing) when idle, so a
   * stray Stop can't suppress tonight's scheduled run.
   */
  requestAnimeAutoMapStop(): boolean {
    if (!this.animeMapRun) return false;
    this.animeMapRun.stop = true;
    this.animeMapWake?.();
    return true;
  }

  /** Stamp "ran today" so the scheduled gate stays closed until tomorrow. */
  private async stampAnimeAutoMapDone(): Promise<void> {
    try {
      await prisma.appSettings.update({
        where: { id: 'singleton' },
        data: { animeAutoMapLastRunAt: new Date() },
      });
    } catch (error) {
      logger.error('Anime auto-map could not stamp its run date', {
        error: errorMessage(error),
      }, { scope: 'polling' });
    }
  }

  /**
   * Sleep that requestAnimeAutoMapStop() can cut short. The run loop is
   * sequential, so at most one sleep is ever pending — one wake slot suffices.
   */
  private interruptibleSleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.animeMapWake = null;
        resolve();
      }, ms);
      this.animeMapWake = () => {
        clearTimeout(timer);
        this.animeMapWake = null;
        resolve();
      };
    });
  }

  /**
   * Start an anime auto-map run unless one is already active. Builds the queue
   * of Sonarr anime that have never been mapped (no AniListSeriesMapping row —
   * existing auto/manual mappings are never touched), then drains it on a
   * detached loop at one series per minute. Never throws.
   */
  async startAnimeAutoMapRun(
    reason: 'manual' | 'scheduled'
  ): Promise<{ started: boolean; queued?: number; reason?: string }> {
    // Claim synchronously before any await so a poll-tick scheduled start and
    // a manual Run-now in the same tick can't both spin up loops.
    if (this.animeMapRun) return { started: false, reason: 'already-running' };
    const run: AnimeAutoMapRun = {
      startedAt: Date.now(),
      stop: false,
      processed: 0,
      failed: 0,
      queueTotal: 0,
      currentTitle: null,
    };
    this.animeMapRun = run;

    let queue: SonarrSeries[];
    try {
      const settings = await getOrCreateAppSettings();
      // The toggle governs the nightly schedule only — a manual Run-now is
      // always allowed. (checkAnimeAutoMap already gates scheduled starts;
      // this is defense-in-depth.)
      if (!settings.animeAutoMapEnabled && reason === 'scheduled') {
        this.animeMapRun = null;
        return { started: false, reason: 'disabled' };
      }

      const client = await getSonarrClient();
      const anime = (await client.getSeries()).filter((s) => s.seriesType === 'anime');
      const rows = await prisma.aniListSeriesMapping.findMany({
        where: { sonarrSeriesId: { in: anime.map((s) => s.id) } },
        select: { sonarrSeriesId: true },
      });
      const mappedIds = new Set(rows.map((row) => row.sonarrSeriesId));
      queue = anime.filter((s) => !mappedIds.has(s.id));
    } catch (error) {
      // Sonarr/DB unavailable — release the claim WITHOUT stamping, so being
      // down at the scheduled hour doesn't consume the day; a later poll retries.
      this.animeMapRun = null;
      logger.debug('Anime auto-map skipped: could not build its queue', {
        error: errorMessage(error),
      }, { scope: 'polling' });
      return { started: false, reason: 'sonarr-unavailable' };
    }

    if (queue.length === 0) {
      // Every anime already has a row — stamp "done today" so the scheduled
      // gate stays closed instead of rebuilding this queue every poll cycle.
      this.animeMapRun = null;
      await this.stampAnimeAutoMapDone();
      return { started: false, reason: 'nothing-to-map', queued: 0 };
    }

    run.queueTotal = queue.length;
    logger.info('Anime auto-map run started', { reason, queued: queue.length }, { scope: 'polling' });
    void this.runAnimeAutoMapLoop(queue);
    return { started: true, queued: queue.length };
  }

  /**
   * Detached drain: one never-mapped series per minute until the queue is done
   * or Stop is requested. ensureSeriesAniListMapping() persists AUTO_MATCH
   * (with season siblings auto-linked) or AUTO_UNMATCHED, so every handled
   * series permanently leaves the backlog. A rate-limit error sleeps the
   * window out and retries the same series (429s are global); any other error
   * skips that series so one bad item can't wedge the queue. The exit path
   * always stamps "done today" — including Stop ("done for tonight"; Run-now
   * can override) — and a run that crosses midnight stamps the day it
   * finishes, intentionally consuming that day's slot.
   */
  private async runAnimeAutoMapLoop(queue: SonarrSeries[]): Promise<void> {
    const run = this.animeMapRun;
    if (!run) return;
    try {
      for (let i = 0; i < queue.length; i++) {
        if (run.stop) break;
        const series = queue[i];
        run.currentTitle = series.title;

        // A row may have appeared since the queue was built (manual map, page
        // visit, doubled dev loop) — never re-touch an existing mapping.
        const existing = await prisma.aniListSeriesMapping.findUnique({
          where: { sonarrSeriesId: series.id },
          select: { id: true },
        });
        if (existing) {
          run.processed += 1;
          logger.debug('Anime auto-map skipped already-mapped series', {
            seriesId: series.id,
            title: series.title,
          }, { scope: 'polling' });
          continue;
        }

        let done = false;
        let attemptStartedMs = Date.now();
        while (!done && !run.stop) {
          attemptStartedMs = Date.now();
          try {
            await ensureSeriesAniListMapping(series);
            run.processed += 1;
            done = true;
            logger.debug('Anime auto-map resolved one series', {
              seriesId: series.id,
              title: series.title,
              processed: run.processed,
              queueTotal: run.queueTotal,
            }, { scope: 'polling' });
          } catch (error) {
            if (error instanceof AniListRateLimitError) {
              // Global cooldown — wait it out, then retry this same series.
              logger.debug('Anime auto-map rate-limited; backing off', {
                seriesId: series.id,
                retryAfterSeconds: error.retryAfterSeconds,
              }, { scope: 'polling' });
              await this.interruptibleSleep(Math.max(error.retryAfterSeconds, 60) * 1000);
            } else {
              run.processed += 1;
              run.failed += 1;
              done = true;
              logger.warn('Anime auto-map item failed; skipping it', {
                seriesId: series.id,
                title: series.title,
                error: errorMessage(error),
              }, { scope: 'polling' });
            }
          }
        }
        // Pace distinct items to ~one per minute. The shared AniList limiter's
        // own waits are inside the elapsed time, so the two never stack.
        if (done && i < queue.length - 1) {
          await this.interruptibleSleep(Math.max(60_000 - (Date.now() - attemptStartedMs), 0));
        }
      }
    } catch (error) {
      logger.error('Anime auto-map run crashed', { error: errorMessage(error) }, { scope: 'polling' });
    } finally {
      logger.info('Anime auto-map run finished', {
        processed: run.processed,
        failed: run.failed,
        queueTotal: run.queueTotal,
        stopped: run.stop,
      }, { scope: 'polling' });
      await this.stampAnimeAutoMapDone();
      this.animeMapRun = null;
      this.animeMapWake = null;
    }
  }

  // Daily anime auto-map scheduling gate. The run itself lives on a detached
  // loop (startAnimeAutoMapRun); this only decides "is it time tonight?" —
  // first poll at/after the configured local hour, once per local calendar
  // day. Catch-up style: a server that was off at the hour still runs on its
  // next poll that day. Toggling the setting off prevents the next scheduled
  // run but doesn't kill an in-flight one (Stop is the halt control).
  private async checkAnimeAutoMap(): Promise<void> {
    if (this.animeMapRun) return;
    const settings = await getOrCreateAppSettings();
    if (!settings.animeAutoMapEnabled) return;

    const timeZone = settings.timeZone;
    const now = new Date();
    if (toZonedDate(now, timeZone).getHours() < settings.animeAutoMapHour) return;
    const lastRun = settings.animeAutoMapLastRunAt;
    if (lastRun && getLocalDateKey(lastRun, timeZone) === getLocalDateKey(now, timeZone)) return;

    void this.startAnimeAutoMapRun('scheduled').catch((error) =>
      logger.error('Anime auto-map scheduled start failed', {
        error: errorMessage(error),
      }, { scope: 'polling' })
    );
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
    const queue = await fetchAllQueueRecords(client);
    const prevMap = readQueueSnapshots(state.lastQueueIds);
    const currentSnapshots: QueueSnapshot[] = queue.records.map((r) => ({
      id: r.id,
      state: r.trackedDownloadState ?? '',
      status: r.trackedDownloadStatus ?? '',
    }));
    let newQueueCount = 0;
    let importIssueCount = 0;
    let downloadFailedCount = 0;

    for (const item of queue.records) {
      const metadata = {
        source: 'sonarr' as const,
        id: item.id,
        seriesId: item.seriesId,
        seasonNumber: item.seasonNumber ?? item.episode?.seasonNumber,
        episodeId: item.episodeId ?? item.episode?.id,
      };
      const mediaHref = getMediaHrefFromIds(metadata);
      const queueHref = '/activity?tab=queue&source=sonarr';
      const failedTabHref = '/activity?tab=failed&source=sonarr';

      const prev = prevMap.get(item.id);
      const currentIssue = classifyQueueIssue(item.trackedDownloadState, item.trackedDownloadStatus);
      const prevIssue =
        prev && prev !== 'legacy'
          ? classifyQueueIssue(prev.state, prev.status)
          : null;

      if (!prev) {
        // Item is new in the queue this cycle.
        newQueueCount++;
        if (currentIssue === 'import') {
          importIssueCount++;
          const redirect = failedTabHref;
          await this.notifyAndLog({
            eventType: 'importFailed',
            title: 'Manual Import Required',
            body: importFailureBody(item),
            metadata: { ...metadata, redirect, state: item.trackedDownloadState },
            url: redirect,
          }, { service: 'sonarr', reason: 'queue-import-blocked-new', itemId: item.id });
        } else if (currentIssue === 'download') {
          downloadFailedCount++;
          const redirect = queueHref;
          await this.notifyAndLog({
            eventType: 'downloadFailed',
            title: 'Download Failed',
            body: downloadFailureBody(item),
            metadata: { ...metadata, redirect, state: item.trackedDownloadState },
            url: redirect,
          }, { service: 'sonarr', reason: 'queue-download-failed-new', itemId: item.id });
        } else {
          const redirect = mediaHref ?? queueHref;
          await this.notifyAndLog({
            eventType: 'grabbed',
            title: 'Download Started',
            body: item.title,
            metadata: { ...metadata, redirect },
            url: redirect,
          }, { service: 'sonarr', reason: 'queue-new-item', itemId: item.id });
        }
      } else if (prev !== 'legacy' && currentIssue !== prevIssue) {
        // Transition into a problematic state — fire the matching notification.
        // Transitions back to normal are silent (success is announced by the
        // history "imported" event).
        if (currentIssue === 'import') {
          importIssueCount++;
          const redirect = failedTabHref;
          await this.notifyAndLog({
            eventType: 'importFailed',
            title: 'Manual Import Required',
            body: importFailureBody(item),
            metadata: { ...metadata, redirect, state: item.trackedDownloadState },
            url: redirect,
          }, { service: 'sonarr', reason: 'queue-import-blocked-transition', itemId: item.id });
        } else if (currentIssue === 'download') {
          downloadFailedCount++;
          const redirect = queueHref;
          await this.notifyAndLog({
            eventType: 'downloadFailed',
            title: 'Download Failed',
            body: downloadFailureBody(item),
            metadata: { ...metadata, redirect, state: item.trackedDownloadState },
            url: redirect,
          }, { service: 'sonarr', reason: 'queue-download-failed-transition', itemId: item.id });
        }
      }
    }

    logger.debug('Sonarr queue polled', {
      queueCount: queue.records.length,
      previousQueueCount: prevMap.size,
      newQueueCount,
      importIssueCount,
      downloadFailedCount,
    }, { scope: 'polling' });

    // Nav badge: total = full queue size; attention = items currently in a
    // failed/import-blocked state (computed over the fetched page).
    await writeBadgeSlice('activity', 'sonarr', {
      total: queue.totalRecords,
      attention: queue.records.filter(
        (r) => classifyQueueIssue(r.trackedDownloadState, r.trackedDownloadStatus) !== null,
      ).length,
    });

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
        lastQueueIds: currentSnapshots as unknown as object,
        lastHistoryDate: history.records[0]?.date ? new Date(history.records[0].date) : state.lastHistoryDate,
        lastHealthHash: healthHash,
      },
    });
    logger.debug('Sonarr polling state updated', {
      queueCount: currentSnapshots.length,
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

    const queue = await fetchAllQueueRecords(client);
    const prevMap = readQueueSnapshots(state.lastQueueIds);
    const currentSnapshots: QueueSnapshot[] = queue.records.map((r) => ({
      id: r.id,
      state: r.trackedDownloadState ?? '',
      status: r.trackedDownloadStatus ?? '',
    }));
    let newQueueCount = 0;
    let importIssueCount = 0;
    let downloadFailedCount = 0;

    for (const item of queue.records) {
      const metadata = {
        source: 'radarr' as const,
        id: item.id,
        movieId: item.movieId,
      };
      const mediaHref = getMediaHrefFromIds(metadata);
      const queueHref = '/activity?tab=queue&source=radarr';
      const failedTabHref = '/activity?tab=failed&source=radarr';

      const prev = prevMap.get(item.id);
      const currentIssue = classifyQueueIssue(item.trackedDownloadState, item.trackedDownloadStatus);
      const prevIssue =
        prev && prev !== 'legacy'
          ? classifyQueueIssue(prev.state, prev.status)
          : null;

      if (!prev) {
        newQueueCount++;
        if (currentIssue === 'import') {
          importIssueCount++;
          const redirect = failedTabHref;
          await this.notifyAndLog({
            eventType: 'importFailed',
            title: 'Movie Manual Import Required',
            body: importFailureBody(item),
            metadata: { ...metadata, redirect, state: item.trackedDownloadState },
            url: redirect,
          }, { service: 'radarr', reason: 'queue-import-blocked-new', itemId: item.id });
        } else if (currentIssue === 'download') {
          downloadFailedCount++;
          const redirect = queueHref;
          await this.notifyAndLog({
            eventType: 'downloadFailed',
            title: 'Movie Download Failed',
            body: downloadFailureBody(item),
            metadata: { ...metadata, redirect, state: item.trackedDownloadState },
            url: redirect,
          }, { service: 'radarr', reason: 'queue-download-failed-new', itemId: item.id });
        } else {
          const redirect = mediaHref ?? queueHref;
          await this.notifyAndLog({
            eventType: 'grabbed',
            title: 'Movie Download Started',
            body: item.title,
            metadata: { ...metadata, redirect },
            url: redirect,
          }, { service: 'radarr', reason: 'queue-new-item', itemId: item.id });
        }
      } else if (prev !== 'legacy' && currentIssue !== prevIssue) {
        if (currentIssue === 'import') {
          importIssueCount++;
          const redirect = failedTabHref;
          await this.notifyAndLog({
            eventType: 'importFailed',
            title: 'Movie Manual Import Required',
            body: importFailureBody(item),
            metadata: { ...metadata, redirect, state: item.trackedDownloadState },
            url: redirect,
          }, { service: 'radarr', reason: 'queue-import-blocked-transition', itemId: item.id });
        } else if (currentIssue === 'download') {
          downloadFailedCount++;
          const redirect = queueHref;
          await this.notifyAndLog({
            eventType: 'downloadFailed',
            title: 'Movie Download Failed',
            body: downloadFailureBody(item),
            metadata: { ...metadata, redirect, state: item.trackedDownloadState },
            url: redirect,
          }, { service: 'radarr', reason: 'queue-download-failed-transition', itemId: item.id });
        }
      }
    }

    logger.debug('Radarr queue polled', {
      queueCount: queue.records.length,
      previousQueueCount: prevMap.size,
      newQueueCount,
      importIssueCount,
      downloadFailedCount,
    }, { scope: 'polling' });

    // Nav badge: total = full queue size; attention = items currently in a
    // failed/import-blocked state (computed over the fetched page).
    await writeBadgeSlice('activity', 'radarr', {
      total: queue.totalRecords,
      attention: queue.records.filter(
        (r) => classifyQueueIssue(r.trackedDownloadState, r.trackedDownloadStatus) !== null,
      ).length,
    });

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
        lastQueueIds: currentSnapshots as unknown as object,
        lastHistoryDate: history.records[0]?.date ? new Date(history.records[0].date) : state.lastHistoryDate,
        lastHealthHash: healthHash,
      },
    });
    logger.debug('Radarr polling state updated', {
      queueCount: currentSnapshots.length,
      lastHistoryDate: history.records[0]?.date ?? state.lastHistoryDate,
      healthHash,
    }, { scope: 'polling' });
  }

  private async pollLidarr() {
    let client;
    try {
      client = await getLidarrClient();
    } catch (error) {
      logger.debug('Skipping Lidarr poll because client is unavailable', { error }, { scope: 'polling' });
      return;
    }

    const state = await prisma.pollingState.upsert({
      where: { serviceType: 'LIDARR' },
      update: {},
      create: { serviceType: 'LIDARR', lastQueueIds: [] },
    });

    const queue = await fetchAllQueueRecords(client);
    const prevMap = readQueueSnapshots(state.lastQueueIds);
    const currentSnapshots: QueueSnapshot[] = queue.records.map((r) => ({
      id: r.id,
      state: r.trackedDownloadState ?? '',
      status: r.trackedDownloadStatus ?? '',
    }));

    for (const item of queue.records) {
      const metadata = {
        source: 'lidarr' as const,
        id: item.id,
        artistId: item.artistId,
        albumId: item.albumId,
      };
      const mediaHref = getMediaHrefFromIds(metadata);
      const queueHref = '/activity?tab=queue&source=lidarr';
      const failedTabHref = '/activity?tab=failed&source=lidarr';

      const prev = prevMap.get(item.id);
      const currentIssue = classifyQueueIssue(item.trackedDownloadState, item.trackedDownloadStatus);
      const prevIssue =
        prev && prev !== 'legacy'
          ? classifyQueueIssue(prev.state, prev.status)
          : null;

      if (!prev) {
        if (currentIssue === 'import') {
          await this.notifyAndLog({
            eventType: 'importFailed',
            title: 'Album Manual Import Required',
            body: importFailureBody(item),
            metadata: { ...metadata, redirect: failedTabHref, state: item.trackedDownloadState },
            url: failedTabHref,
          }, { service: 'lidarr', reason: 'queue-import-blocked-new', itemId: item.id });
        } else if (currentIssue === 'download') {
          await this.notifyAndLog({
            eventType: 'downloadFailed',
            title: 'Album Download Failed',
            body: downloadFailureBody(item),
            metadata: { ...metadata, redirect: queueHref, state: item.trackedDownloadState },
            url: queueHref,
          }, { service: 'lidarr', reason: 'queue-download-failed-new', itemId: item.id });
        } else {
          const redirect = mediaHref ?? queueHref;
          await this.notifyAndLog({
            eventType: 'grabbed',
            title: 'Album Download Started',
            body: item.title,
            metadata: { ...metadata, redirect },
            url: redirect,
          }, { service: 'lidarr', reason: 'queue-new-item', itemId: item.id });
        }
      } else if (prev !== 'legacy' && currentIssue !== prevIssue) {
        if (currentIssue === 'import') {
          await this.notifyAndLog({
            eventType: 'importFailed',
            title: 'Album Manual Import Required',
            body: importFailureBody(item),
            metadata: { ...metadata, redirect: failedTabHref, state: item.trackedDownloadState },
            url: failedTabHref,
          }, { service: 'lidarr', reason: 'queue-import-blocked-transition', itemId: item.id });
        } else if (currentIssue === 'download') {
          await this.notifyAndLog({
            eventType: 'downloadFailed',
            title: 'Album Download Failed',
            body: downloadFailureBody(item),
            metadata: { ...metadata, redirect: queueHref, state: item.trackedDownloadState },
            url: queueHref,
          }, { service: 'lidarr', reason: 'queue-download-failed-transition', itemId: item.id });
        }
      }
    }

    // Nav badge: total = full queue size; attention = items currently in a
    // failed/import-blocked state (computed over the fetched page).
    await writeBadgeSlice('activity', 'lidarr', {
      total: queue.totalRecords,
      attention: queue.records.filter(
        (r) => classifyQueueIssue(r.trackedDownloadState, r.trackedDownloadStatus) !== null,
      ).length,
    });

    const history = await client.getHistory(1, 50, 'date', 'descending');
    const lastDate = state.lastHistoryDate;
    const newHistory = lastDate
      ? history.records.filter((r) => new Date(r.date) > new Date(lastDate))
      : [];

    for (const item of newHistory) {
      if (item.eventType === 'downloadImported' || item.eventType === 'trackFileImported') {
        const metadata = {
          source: 'lidarr' as const,
          id: item.id,
          artistId: item.artistId,
          albumId: item.albumId,
        };
        const redirect = getMediaHrefFromIds(metadata) ?? '/activity/history';
        await this.notifyAndLog({
          eventType: 'imported',
          title: 'Album Imported',
          body: `${item.sourceTitle}`,
          metadata: { ...metadata, redirect },
          url: redirect,
        }, { service: 'lidarr', reason: 'history-imported', historyId: item.id });
      }
    }

    const health = await client.getHealth();
    const healthHash = crypto.createHash('md5').update(JSON.stringify(health)).digest('hex');
    if (state.lastHealthHash && healthHash !== state.lastHealthHash && health.length > 0) {
      await this.notifyAndLog({
        eventType: 'healthWarning',
        title: 'Lidarr Health Warning',
        body: health.map((h) => h.message).join('; ').slice(0, 200),
        url: '/settings',
      }, { service: 'lidarr', reason: 'health-changed', healthCount: health.length });
    }

    await prisma.pollingState.update({
      where: { serviceType: 'LIDARR' },
      data: {
        lastQueueIds: currentSnapshots as unknown as object,
        lastHistoryDate: history.records[0]?.date ? new Date(history.records[0].date) : state.lastHistoryDate,
        lastHealthHash: healthHash,
      },
    });
    logger.debug('Lidarr polling state updated', {
      queueCount: currentSnapshots.length,
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

    // Nav badge: total = downloads still in flight (progress < 1); attention =
    // the in-flight subset that's stalled or errored (so attention <= total).
    const inFlightTorrents = torrents.filter((t) => t.progress < 1);
    await writeBadgeSlice('downloads', 'qbittorrent', {
      total: inFlightTorrents.length,
      attention: inFlightTorrents.filter(
        (t) => t.state === 'error' || t.state === 'missingFiles' || t.state === 'stalledDL',
      ).length,
    });

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

  private async pollSeerr() {
    let client;
    try {
      client = await getSeerrClient();
    } catch (error) {
      logger.debug('Skipping Seerr poll because client is unavailable', { error }, { scope: 'polling' });
      return;
    }

    const state = await prisma.pollingState.upsert({
      where: { serviceType: 'SEERR' },
      update: {},
      create: { serviceType: 'SEERR', lastQueueIds: [] },
    });

    let listing;
    try {
      listing = await client.listRequests({ take: 50, skip: 0, sort: 'added', sortDirection: 'desc' });
    } catch (error) {
      logger.warn('Seerr request poll failed', error, { scope: 'polling' });
      return;
    }

    const requests = listing.results;

    type Snapshot = { id: number; reqStatus: number; mediaStatus: number };
    const prevSnapshots: Snapshot[] = Array.isArray(state.lastQueueIds)
      ? (state.lastQueueIds as unknown as Snapshot[]).filter(
          (s) =>
            s &&
            typeof s === 'object' &&
            typeof (s as Snapshot).id === 'number' &&
            typeof (s as Snapshot).reqStatus === 'number' &&
            typeof (s as Snapshot).mediaStatus === 'number'
        )
      : [];
    const prevMap = new Map(prevSnapshots.map((s) => [s.id, s]));
    const firstRun = prevSnapshots.length === 0;
    // High-water mark: Seerr request IDs are auto-increment, so anything not
    // in prevMap whose id is <= lastMaxId is an old request that slid into our
    // top-50 window because a newer one was deleted — not a creation.
    const lastMaxId = prevSnapshots.reduce((m, s) => (s.id > m ? s.id : m), 0);

    logger.debug('Seerr requests polled', {
      requestCount: requests.length,
      previousCount: prevSnapshots.length,
      firstRun,
    }, { scope: 'polling' });

    // Request-status notifications go to the requesting member plus every admin
    // (approvers stay in the loop). Resolve the admin list once per cycle.
    const adminIds = (
      await prisma.user.findMany({
        where: { role: 'admin', status: 'active' },
        select: { id: true },
      })
    ).map((u) => u.id);

    // Resolve the Helprr owner for every requester in this window in a single
    // query (batched instead of one findFirst per notifying request), keyed by
    // the Seerr user id so the loop is a Map lookup.
    const seerrIds = Array.from(
      new Set(
        requests
          .map((req) => req.requestedBy?.id)
          .filter((id): id is number => id != null)
          .map((id) => String(id))
      )
    );
    const ownerBySeerrId = new Map(
      seerrIds.length
        ? (
            await prisma.user.findMany({
              where: { seerrUserId: { in: seerrIds } },
              select: { id: true, seerrUserId: true },
            })
          ).map((u) => [u.seerrUserId as string, u.id])
        : []
    );

    for (const req of requests) {
      const reqStatus = Number(req.status);
      const mediaStatus = Number(req.media?.status ?? 0);
      const prev = prevMap.get(req.id);
      const requesterLabel =
        req.requestedBy?.displayName ??
        req.requestedBy?.username ??
        req.requestedBy?.plexUsername ??
        req.requestedBy?.jellyfinUsername ??
        `User ${req.requestedBy?.id ?? '?'}`;
      const tmdbId = req.media?.tmdbId;

      // Decide whether this iteration will actually emit a notification before
      // we spend a TMDB lookup — skipping the fetch for the no-op case on the
      // first run keeps poll cycles cheap.
      const willCreate = !prev && !firstRun && req.id > lastMaxId;
      const willStatusChange =
        !!prev &&
        prev.reqStatus !== reqStatus &&
        (reqStatus === SEERR_REQUEST_STATUS.APPROVED ||
          reqStatus === SEERR_REQUEST_STATUS.DECLINED ||
          reqStatus === SEERR_REQUEST_STATUS.FAILED);
      const willBecomeAvailable =
        !!prev &&
        prev.mediaStatus !== mediaStatus &&
        mediaStatus === SEERR_MEDIA_STATUS.AVAILABLE &&
        prev.mediaStatus < SEERR_MEDIA_STATUS.AVAILABLE;

      let detail = null;
      if ((willCreate || willStatusChange || willBecomeAvailable) && tmdbId) {
        try {
          detail = await getCachedSeerrMediaDetail(client, req.type, tmdbId);
        } catch (error) {
          logger.debug('Seerr media detail lookup failed', { error, requestId: req.id }, { scope: 'polling' });
        }
      }
      const mediaLabel = formatSeerrMediaLabel(req, detail);
      const title = detail?.title ?? detail?.name ?? null;
      const metadataBase = {
        source: 'seerr' as const,
        id: req.id,
        tmdbId,
        mediaType: req.type,
        title,
        redirect: '/requests',
      };

      // The Helprr user behind this Seerr request (if linked); status updates are
      // owned by them, with admins copied in.
      const seerrId = req.requestedBy?.id;
      const ownerId = seerrId != null ? ownerBySeerrId.get(String(seerrId)) ?? null : null;
      const ownerAndAdmins = Array.from(new Set([...(ownerId ? [ownerId] : []), ...adminIds]));

      if (!prev) {
        if (firstRun || req.id <= lastMaxId) continue;
        // A brand-new request notifies approvers (admins), not the requester.
        await this.notifyAndLog({
          eventType: 'requestCreated',
          title: 'New Request',
          body: `${requesterLabel} requested ${mediaLabel}`,
          metadata: metadataBase,
          url: '/requests',
          userIds: adminIds.length ? adminIds : undefined,
        }, { service: 'seerr', reason: 'request-created', requestId: req.id });
        continue;
      }

      if (prev.reqStatus !== reqStatus) {
        if (reqStatus === SEERR_REQUEST_STATUS.APPROVED) {
          await this.notifyAndLog({
            eventType: 'requestApproved',
            title: 'Request Approved',
            body: `${requesterLabel}'s request for ${mediaLabel} was approved`,
            metadata: metadataBase,
            url: '/requests',
            userIds: ownerAndAdmins.length ? ownerAndAdmins : undefined,
            ownerUserId: ownerId,
          }, { service: 'seerr', reason: 'request-approved', requestId: req.id });
        } else if (reqStatus === SEERR_REQUEST_STATUS.DECLINED) {
          await this.notifyAndLog({
            eventType: 'requestDeclined',
            title: 'Request Declined',
            body: `${requesterLabel}'s request for ${mediaLabel} was declined`,
            metadata: metadataBase,
            url: '/requests',
            userIds: ownerAndAdmins.length ? ownerAndAdmins : undefined,
            ownerUserId: ownerId,
          }, { service: 'seerr', reason: 'request-declined', requestId: req.id });
        } else if (reqStatus === SEERR_REQUEST_STATUS.FAILED) {
          await this.notifyAndLog({
            eventType: 'requestFailed',
            title: 'Request Failed',
            body: `${requesterLabel}'s request for ${mediaLabel} failed`,
            metadata: metadataBase,
            url: '/requests',
            userIds: ownerAndAdmins.length ? ownerAndAdmins : undefined,
            ownerUserId: ownerId,
          }, { service: 'seerr', reason: 'request-failed', requestId: req.id });
        }
      }

      if (
        prev.mediaStatus !== mediaStatus &&
        mediaStatus === SEERR_MEDIA_STATUS.AVAILABLE &&
        prev.mediaStatus < SEERR_MEDIA_STATUS.AVAILABLE
      ) {
        await this.notifyAndLog({
          eventType: 'requestAvailable',
          title: 'Request Available',
          body: `${mediaLabel} is now available (requested by ${requesterLabel})`,
          metadata: metadataBase,
          url: '/requests',
          userIds: ownerAndAdmins.length ? ownerAndAdmins : undefined,
          ownerUserId: ownerId,
        }, { service: 'seerr', reason: 'request-available', requestId: req.id });
      }
    }

    const nextSnapshots: Snapshot[] = requests.map((r) => ({
      id: r.id,
      reqStatus: Number(r.status),
      mediaStatus: Number(r.media?.status ?? 0),
    }));

    await prisma.pollingState.update({
      where: { serviceType: 'SEERR' },
      data: { lastQueueIds: nextSnapshots as unknown as object },
    });
    logger.debug('Seerr polling state updated', {
      requestCount: nextSnapshots.length,
    }, { scope: 'polling' });

    // Nav badge: pending approvals. The top-50 window above can miss older
    // pending items, so use the dedicated count endpoint for an accurate number.
    try {
      const counts = await client.getRequestCount();
      await writeBadgeSlice('requests', 'seerr', {
        total: counts.pending,
        attention: counts.pending,
      });
    } catch (error) {
      logger.debug('Seerr request-count badge fetch failed', { error }, { scope: 'polling' });
    }
  }

  private async checkUpcoming() {
    const settings = await getOrCreateAppSettings();
    const timeZone = settings.timeZone;

    const mode: 'before_air' | 'daily_digest' =
      settings.upcomingNotifyMode === 'daily_digest' ? 'daily_digest' : 'before_air';
    const now = new Date();
    logger.debug('Upcoming poll started', {
      mode,
      timeZone,
      dailyNotifyHour: settings.upcomingDailyNotifyHour,
      notifyBeforeMins: settings.upcomingNotifyBeforeMins,
    }, { scope: 'polling' });

    // Compute the calendar fetch window per mode:
    //   before_air   : [now - grace, now + notifyBeforeMins + buffer]
    //                  Grace lets "0 min / at air time" still fire when the
    //                  poll lands a few seconds after the air moment.
    //   daily_digest : the entire local calendar day, gated by hour. Per-item
    //                  dedupeKey prevents duplicates within the digest hour.
    let fetchStartMs: number;
    let fetchEndMs: number;

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

      // Per-item dedupeKey suppresses duplicates within the digest hour, so we
      // don't need a coarse "any-row-today → bail" guard. Removing it also
      // means a partial-failure digest can resume on the next poll instead of
      // locking out the rest of the day's items.
      fetchStartMs = startOfLocalDay(now, timeZone).getTime();
      fetchEndMs = endOfLocalDay(now, timeZone).getTime();
    } else {
      fetchStartMs = now.getTime() - BEFORE_AIR_GRACE_MIN * 60_000;
      fetchEndMs = now.getTime() + settings.upcomingNotifyBeforeMins * 60_000 + FETCH_END_BUFFER_MS;
    }

    const start = new Date(fetchStartMs).toISOString();
    const end = new Date(fetchEndMs).toISOString();

    // Helpers ----------------------------------------------------------------
    // For each candidate item we ask: "have we ever notified for this exact
    // (item, air-time) pair?" If not, fire. The dedupeKey embeds the full air
    // timestamp so any reschedule — even same-day — produces a fresh key and
    // a fresh notification. Body-string fallback preserves dedupe for rows
    // created before the migration added dedupeKey.
    const alreadyNotified = async (dedupeKey: string, body: string): Promise<boolean> => {
      const hit = await prisma.notificationHistory.findFirst({
        where: {
          eventType: 'upcomingPremiere',
          OR: [{ dedupeKey }, { dedupeKey: null, body }],
        },
        select: { id: true },
      });
      return Boolean(hit);
    };

    const shouldFireBeforeAir = (airTimeMs: number): boolean => {
      const minsUntilAir = (airTimeMs - now.getTime()) / 60_000;
      return (
        minsUntilAir <= settings.upcomingNotifyBeforeMins &&
        minsUntilAir >= -BEFORE_AIR_GRACE_MIN
      );
    };

    // Sonarr calendar --------------------------------------------------------
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
        if (!ep.series || !ep.airDateUtc) continue;
        const airTimeMs = new Date(ep.airDateUtc).getTime();
        if (!Number.isFinite(airTimeMs)) continue;

        // For daily_digest, the fetch already constrains to today, but keep a
        // defensive guard in case Sonarr returns an item outside the window.
        if (airTimeMs < fetchStartMs || airTimeMs > fetchEndMs) continue;

        if (mode === 'before_air' && !shouldFireBeforeAir(airTimeMs)) {
          logger.debug('Skipping Sonarr upcoming item outside before-air window', {
            seriesId: ep.seriesId,
            episodeId: ep.id,
            minsUntilAir: (airTimeMs - now.getTime()) / 60_000,
            notifyBeforeMins: settings.upcomingNotifyBeforeMins,
          }, { scope: 'polling' });
          continue;
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
        const dedupeKey = `sonarr-ep-${ep.id}-${airTimeMs}`;

        if (await alreadyNotified(dedupeKey, body)) {
          logger.debug('Skipping duplicate Sonarr upcoming notification', {
            seriesId: ep.seriesId,
            episodeId: ep.id,
            dedupeKey,
          }, { scope: 'polling' });
          continue;
        }

        await this.notifyAndLog({
          eventType: 'upcomingPremiere',
          title: notificationTitle,
          body,
          dedupeKey,
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
          dedupeKey,
        });
      }
    } catch (error) {
      logger.warn('Sonarr upcoming calendar poll failed', error, { scope: 'polling' });
    }

    // Radarr calendar --------------------------------------------------------
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
          const releaseMs = new Date(dateStr).getTime();
          if (!Number.isFinite(releaseMs)) continue;

          // Skip release dates outside the fetch window. Radarr returns a
          // movie if ANY of its 3 release dates falls in the window, so the
          // other two might be years away (e.g., cinema 2010, digital today).
          if (releaseMs < fetchStartMs || releaseMs > fetchEndMs) continue;

          if (mode === 'before_air' && !shouldFireBeforeAir(releaseMs)) {
            logger.debug('Skipping Radarr upcoming item outside before-air window', {
              movieId: movie.id,
              releaseType,
              minsUntilAir: (releaseMs - now.getTime()) / 60_000,
              notifyBeforeMins: settings.upcomingNotifyBeforeMins,
            }, { scope: 'polling' });
            continue;
          }

          const body = `${movie.title} (${movie.year}) — ${releaseTypeLabels[releaseType]}`;
          const dedupeKey = `radarr-${movie.id}-${releaseType}-${releaseMs}`;

          if (await alreadyNotified(dedupeKey, body)) {
            logger.debug('Skipping duplicate Radarr upcoming notification', {
              movieId: movie.id,
              releaseType,
              dedupeKey,
            }, { scope: 'polling' });
            continue;
          }

          await this.notifyAndLog({
            eventType: 'upcomingPremiere',
            title: 'Upcoming Movie',
            body,
            dedupeKey,
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
            dedupeKey,
          });
        }
      }
    } catch (error) {
      logger.warn('Radarr upcoming calendar poll failed', error, { scope: 'polling' });
    }

    // Lidarr calendar --------------------------------------------------------
    try {
      const client = await getLidarrClient();
      const calendar = await client.getCalendar(start, end);
      logger.debug('Lidarr upcoming calendar polled', {
        calendarCount: calendar.length,
        start,
        end,
        mode,
      }, { scope: 'polling' });
      for (const album of calendar) {
        if (!album.releaseDate) continue;
        const releaseMs = new Date(album.releaseDate).getTime();
        if (!Number.isFinite(releaseMs)) continue;
        if (releaseMs < fetchStartMs || releaseMs > fetchEndMs) continue;
        if (mode === 'before_air' && !shouldFireBeforeAir(releaseMs)) continue;

        const artistName = album.artist?.artistName ?? '';
        const body = `${artistName ? `${artistName} — ` : ''}${album.title}`;
        const dedupeKey = `lidarr-${album.id}-${releaseMs}`;
        if (await alreadyNotified(dedupeKey, body)) continue;

        await this.notifyAndLog({
          eventType: 'upcomingPremiere',
          title: 'Upcoming Album',
          body,
          dedupeKey,
          metadata: {
            source: 'lidarr',
            artistId: album.artistId,
            albumId: album.id,
            redirect: `/music/album/${album.id}`,
          },
          url: `/music/album/${album.id}`,
        }, {
          service: 'lidarr',
          reason: 'upcoming-premiere',
          albumId: album.id,
          dedupeKey,
        });
      }
    } catch (error) {
      logger.warn('Lidarr upcoming calendar poll failed', error, { scope: 'polling' });
    }
  }

  private async checkWatchlistReminders(): Promise<void> {
    const now = new Date();
    const due = await prisma.watchlistItem.findMany({
      where: {
        reminderAt: { lte: now },
        reminderNotifiedAt: null,
        reminderAttempts: { lt: MAX_REMINDER_ATTEMPTS },
      },
      take: 50,
    });
    if (due.length === 0) return;
    logger.debug('Watchlist reminders due', { count: due.length }, { scope: 'polling' });

    // If any due items might resolve into Sonarr/Radarr, fetch the lookups
    // once so we can silently mark already-downloaded items as notified —
    // pinging the user about something they've already added is noise.
    const needsLookup = due.some(
      (i) =>
        (i.source === 'TMDB' && i.mediaType === 'movie') ||
        (i.source === 'TMDB' && i.mediaType === 'series') ||
        (i.source === 'TVDB' && i.mediaType === 'series') ||
        i.source === 'SONARR' ||
        i.source === 'RADARR'
    );
    const lookups = needsLookup
      ? await getLibraryLookups({
          tmdbMovie: due.some((i) => i.source === 'TMDB' && i.mediaType === 'movie'),
          tvdbSeries: due.some((i) => i.source === 'TVDB' && i.mediaType === 'series'),
          tmdbSeries: due.some((i) => i.source === 'TMDB' && i.mediaType === 'series'),
        }).catch((error) => {
          logger.warn('Watchlist reminder library lookup failed; sending reminders without library skip', { error }, { scope: 'polling' });
          return null;
        })
      : null;

    for (const item of due) {
      if (lookups && isItemInLibrary(item.source, item.externalId, item.mediaType, lookups)) {
        await prisma.watchlistItem.update({
          where: { id: item.id },
          data: { reminderNotifiedAt: now },
        }).catch((error) => {
          logger.warn('Failed to mark in-library watchlist reminder as notified', { itemId: item.id, error }, { scope: 'polling' });
        });
        continue;
      }

      const yearSuffix = item.year ? ` (${item.year})` : '';
      const body = `${item.title}${yearSuffix}`;
      const redirect = watchlistHrefFor(item.source, item.externalId, item.mediaType) ?? '/watchlist';
      let delivered = false;
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
          // A watchlist reminder is personal: only ping the owner's devices and
          // stamp the history row to the owner so it shows in *their* list.
          ...(item.userId ? { userIds: [item.userId], ownerUserId: item.userId } : {}),
        }, { service: 'watchlist', reason: 'reminder-due', itemId: item.id });
        delivered = true;
      } catch (error) {
        logger.warn('Watchlist reminder push failed; will retry', { itemId: item.id, attempt: item.reminderAttempts + 1, error }, { scope: 'polling' });
      }

      const nextAttempts = item.reminderAttempts + 1;
      const giveUp = !delivered && nextAttempts >= MAX_REMINDER_ATTEMPTS;
      await prisma.watchlistItem.update({
        where: { id: item.id },
        data: {
          reminderAttempts: nextAttempts,
          // Stamp notified on success OR after we exhaust retries — both
          // states mean "stop trying this reminder".
          reminderNotifiedAt: delivered || giveUp ? now : null,
        },
      }).catch((error) => {
        logger.warn('Failed to update watchlist reminder state', { itemId: item.id, error }, { scope: 'polling' });
      });
    }
  }

  // Prune NotificationHistory rows past the configured retention window. The
  // poll loop runs every ~30s, so throttle the actual DELETE to once/day. The
  // @@index([createdAt]) keeps the sweep cheap even when nothing is due.
  private async checkNotificationRetention(): Promise<void> {
    const now = Date.now();
    if (now - this.lastNotificationPruneAt < 86_400_000) return;

    const settings = await getOrCreateAppSettings();
    const days = settings.notificationHistoryRetentionDays;
    const cutoff = new Date(now - days * 86_400_000);
    const { count } = await prisma.notificationHistory.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    // Advance the throttle only after a successful sweep, so a transient DB
    // error retries on the next cycle instead of being skipped for a full day.
    this.lastNotificationPruneAt = now;
    if (count > 0) {
      logger.info(
        'Pruned old notification history',
        { deleted: count, retentionDays: days },
        { scope: 'polling' },
      );
    }
  }

  private async checkActivityDigest(): Promise<void> {
    const settings = await getOrCreateAppSettings();
    const mode = settings.activityDigestMode;
    if (mode !== 'daily' && mode !== 'weekly') return;

    const period: ActivityDigestPeriod = mode;
    const timeZone = settings.timeZone;
    const now = new Date();
    const zoned = toZonedDate(now, timeZone);
    const localHour = zoned.getHours();
    const localDow = zoned.getDay(); // 0=Sun..6=Sat
    const localDateLabel = `${zoned.getFullYear()}-${String(zoned.getMonth() + 1).padStart(2, '0')}-${String(zoned.getDate()).padStart(2, '0')}`;

    // Catch-up: fire on the first poll AT OR AFTER the configured hour rather
    // than only on the exact hour, so a missed hour (downtime, deploy, DST gap)
    // still sends later the same day. The per-window dedupeKey below guarantees
    // it only sends once.
    if (localHour < settings.activityDigestHour) {
      logger.debug('Skipping activity digest before configured hour', {
        period,
        localHour,
        digestHour: settings.activityDigestHour,
        timeZone,
      }, { scope: 'polling' });
      return;
    }

    if (period === 'weekly' && localDow !== settings.activityDigestDayOfWeek) {
      logger.debug('Skipping activity digest outside configured day-of-week', {
        period,
        localDow,
        digestDayOfWeek: settings.activityDigestDayOfWeek,
        timeZone,
      }, { scope: 'polling' });
      return;
    }

    // dedupeKey carries period + local date so a daily digest and a weekly
    // digest landing on the same morning don't collide. notifyEvent itself does
    // NOT dedupe (it only stamps dedupeKey onto the history row it writes), so
    // the findFirst guard below is what prevents re-sending within the window —
    // do not remove it.
    const dedupeKey = `activity-digest-${period}-${localDateLabel}`;
    const existing = await prisma.notificationHistory.findFirst({
      where: { eventType: 'activityDigest', dedupeKey },
      select: { id: true },
    });
    if (existing) {
      logger.debug('Skipping duplicate activity digest in same window', {
        period,
        dedupeKey,
      }, { scope: 'polling' });
      return;
    }

    // Pull the digest window, aligned to the local calendar. Windows are
    // computed via calendar arithmetic (not fixed ms math) so a DST transition
    // inside the window doesn't shift the boundary by an hour.
    //   daily  = the prior full local day [yesterday 00:00, today 00:00) — fired
    //            in the morning it summarizes the complete previous day rather
    //            than the few hours since midnight.
    //   weekly = the trailing 7 local days (today plus the prior six), ending now.
    const dayStart = startOfLocalDay(now, timeZone);
    const windowStart =
      period === 'daily'
        ? dateInTimeZone(timeZone, zoned.getFullYear(), zoned.getMonth(), zoned.getDate() - 1)
        : dateInTimeZone(timeZone, zoned.getFullYear(), zoned.getMonth(), zoned.getDate() - 6);
    // Daily is a closed prior-day window; weekly runs up to now (no upper bound).
    const createdAt =
      period === 'daily' ? { gte: windowStart, lt: dayStart } : { gte: windowStart };
    const rows = await prisma.notificationHistory.findMany({
      where: {
        createdAt,
        // Don't summarize the digest itself.
        eventType: { not: 'activityDigest' },
      },
      select: { eventType: true, body: true, metadata: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const digest = buildActivityDigest({ period, rows });
    if (digest.eventCount === 0) {
      logger.debug('Skipping activity digest: nothing happened in the window', {
        period,
        windowStart: windowStart.toISOString(),
      }, { scope: 'polling' });
      return;
    }

    await this.notifyAndLog({
      eventType: 'activityDigest',
      title: digest.title,
      body: digest.body,
      dedupeKey,
      metadata: {
        source: 'digest',
        period,
        windowStart: windowStart.toISOString(),
        eventCount: digest.eventCount,
        sourceCounts: digest.sourceCounts,
        redirect: '/notifications',
      },
      url: '/notifications',
    }, {
      service: 'digest',
      reason: 'activity-digest',
      period,
      dedupeKey,
    });
  }

  // Restore qBit to unlimited (0) if — and only if — we previously applied a
  // limit. This lifts the throttle when a rule's window ends or when the user
  // deletes all rules. When we never applied one, it's a no-op, preserving the
  // strict-additive promise of leaving the user's manual limits alone. Tracking
  // is held until the restore succeeds so a transient qBit outage retries next
  // poll rather than silently dropping the release.
  private async releaseAppliedBandwidth(context: string): Promise<void> {
    const previous = this.appliedBandwidth;
    if (!previous) return;

    let client;
    try {
      client = await getQBittorrentClient();
    } catch (error) {
      logger.debug('Bandwidth schedule: release deferred, qBittorrent unavailable; will retry', { context, error }, { scope: 'polling' });
      return;
    }

    try {
      await Promise.all([
        client.setGlobalDownloadLimit(0),
        client.setGlobalUploadLimit(0),
      ]);
      logger.info('Bandwidth schedule: restored unlimited', {
        context,
        previousRuleId: previous.ruleId,
      }, { scope: 'polling' });
      this.appliedBandwidth = null;
    } catch (error) {
      logger.warn('Failed to restore bandwidth', {
        context,
        previousRuleId: previous.ruleId,
        error,
      }, { scope: 'polling' });
    }
  }

  private async applyBandwidthSchedule(): Promise<void> {
    const settings = await getOrCreateAppSettings();
    const schedule = parseBandwidthSchedule(settings.qbtBandwidthSchedule);
    if (schedule.rules.length === 0) {
      // No rules (or all deleted). Release any throttle we applied so the limit
      // lifts; if we never applied one, this leaves the user's settings alone.
      await this.releaseAppliedBandwidth('schedule-empty');
      return;
    }

    const active = pickActiveRule(schedule.rules, new Date(), settings.timeZone);

    // No active rule — the window has ended. Release the throttle we applied.
    if (!active) {
      await this.releaseAppliedBandwidth('rule-ended');
      return;
    }

    const intent = {
      ruleId: active.id,
      downloadKbps: active.downloadLimitKbps,
      uploadKbps: active.uploadLimitKbps,
    };

    if (
      this.appliedBandwidth &&
      this.appliedBandwidth.ruleId === intent.ruleId &&
      this.appliedBandwidth.downloadKbps === intent.downloadKbps &&
      this.appliedBandwidth.uploadKbps === intent.uploadKbps
    ) {
      return;
    }

    let client;
    try {
      client = await getQBittorrentClient();
    } catch (error) {
      logger.debug('Skipping bandwidth schedule because qBittorrent is unavailable', { error }, { scope: 'polling' });
      return;
    }

    // qBittorrent's transfer API takes bytes/sec; UI/DB use KB/s.
    const downloadBytes = intent.downloadKbps * 1024;
    const uploadBytes = intent.uploadKbps * 1024;

    try {
      await Promise.all([
        client.setGlobalDownloadLimit(downloadBytes),
        client.setGlobalUploadLimit(uploadBytes),
      ]);
      this.appliedBandwidth = intent;
      logger.info('Bandwidth schedule applied', {
        ruleId: intent.ruleId,
        ruleName: active.name,
        downloadKbps: intent.downloadKbps,
        uploadKbps: intent.uploadKbps,
      }, { scope: 'polling' });
    } catch (error) {
      logger.warn('Failed to apply bandwidth schedule', { ruleId: intent.ruleId, error }, { scope: 'polling' });
    }
  }
}

// Stash the singleton on globalThis (same pattern as the cleanup scheduler):
// instrumentation (which runs the poll loop and the anime auto-map run) and
// API route handlers (which trigger/inspect/stop that run) are compiled into
// separate bundles in dev, so a bare module-level instance would give routes
// a blind duplicate that never sees the live run.
const globalForPolling = globalThis as unknown as { __helprrPollingService?: PollingService };
export const pollingService = globalForPolling.__helprrPollingService ?? new PollingService();
globalForPolling.__helprrPollingService = pollingService;
