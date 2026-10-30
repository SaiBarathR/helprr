import { prisma } from '@/lib/db';
import { getSonarrClients, getRadarrClients, getLidarrClients, getQBittorrentClient } from '@/lib/service-helpers';
import { ConfigurationError } from '@/lib/config-error';
import { getAggregatedDiskSpace, diskId } from '@/lib/disk-space';
import { initVapid } from '@/lib/notification-service';
import { getOrCreateAppSettings } from '@/lib/app-settings';
import { ensureSeriesAniListMapping } from '@/lib/anilist-series-mapping';
import { AniListRateLimitError } from '@/lib/anilist-client';
import { toZonedDate, getLocalDateKey } from '@/lib/timezone';
import { parseBandwidthSchedule } from '@/lib/bandwidth-scheduler/parse';
import { pickActiveRule } from '@/lib/bandwidth-scheduler/active-rule';
import { logger, redact } from '@/lib/logger';
import { jobReports, noteJobFailure, noteJobSkipped, type JobReport } from '@/lib/polling-job-report';
import { createPollingCycleContext } from '@/lib/polling-cycle';
import { refreshScheduledAlertOccurrences, checkScheduledAlerts } from '@/lib/scheduled-alerts/delivery';
import { getCachedTaggedLibrary } from '@/lib/cache/tagged-library';
import { runRetentionSweep } from '@/lib/retention';
import { rebuildTasteProfile, PROFILE_MAX_AGE_MS } from '@/lib/recommendations/profile-store';
import { PROFILE_VERSION } from '@/lib/recommendations/profile-types';
import { can } from '@/lib/permissions';
import type { SonarrSeries } from '@/types';
import { reconcileManualDownloads } from '@/lib/manual-downloads/status';
import { errorMessage, type AppSettingsSnapshot, type CycleContext } from '@/lib/polling/shared';
import { pollSonarr as pollSonarrPoller } from '@/lib/polling/poll-sonarr';
import { pollRadarr as pollRadarrPoller } from '@/lib/polling/poll-radarr';
import { pollLidarr as pollLidarrPoller } from '@/lib/polling/poll-lidarr';
import { pollQBittorrent as pollQBittorrentPoller } from '@/lib/polling/poll-qbittorrent';
import { pollJellyfin as pollJellyfinPoller } from '@/lib/polling/poll-jellyfin';
import { pollSeerr as pollSeerrPoller } from '@/lib/polling/poll-seerr';
import { pollProwlarr as pollProwlarrPoller } from '@/lib/polling/poll-prowlarr';
import { pollServiceReachability as pollServiceReachabilityPoller } from '@/lib/polling/service-reachability';
import { pollTwitch } from '@/lib/polling/poll-twitch';
import { checkDiskSpace as checkDiskSpacePoller } from '@/lib/polling/disk-space-alerts';
import { checkUpcoming as checkUpcomingPoller } from '@/lib/polling/upcoming';
import { checkActivityDigest as checkActivityDigestPoller } from '@/lib/polling/activity-digest';

// How long daily disk-usage snapshots are kept (the trend only needs ~7 days,
// but a longer tail makes the growth-rate fit more stable + survives gaps).
const DISK_SNAPSHOT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

// Taste-profile background sweep: how often to look for stale profiles, which
// users qualify (a session seen inside the window = "active"), and how many
// rebuilds one sweep may run (each costs Jellyfin scans + AniList reads, so
// the tail drains over subsequent sweeps instead of spiking one).
const TASTE_PROFILE_SWEEP_INTERVAL_MS = 30 * 60 * 1000;
const TASTE_PROFILE_ACTIVE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const TASTE_PROFILE_MAX_REBUILDS_PER_SWEEP = 5;

function localDateOnly(input: Date, timeZone: string): Date {
  return new Date(`${getLocalDateKey(input, timeZone)}T00:00:00.000Z`);
}

type AnimeAutoMapRun = {
  startedAt: number;
  stop: boolean;
  processed: number;
  failed: number;
  queueTotal: number;
  currentTitle: string | null;
};

/**
 * Warm one library. The loader keeps going past an instance that fails (one bad
 * instance must not blank the rest), so a warm that read one is still a failure;
 * no configured instance at all is not.
 */
async function warmLibrary<C, T extends object>(
  scope: string,
  getInstances: () => Promise<Array<{ connection: { id: string; label: string }; client: C }>>,
  fetchOne: (client: C) => Promise<T[]>,
): Promise<void> {
  let configured = 0;
  const result = await getCachedTaggedLibrary({
    scope,
    cacheKeySeed: 'all',
    getInstances: async () => {
      const instances = await getInstances();
      configured = instances.length;
      return instances;
    },
    fetchOne,
  });
  // A load this warm joined (or a cache hit) never asked for the instances.
  if (!result.complete && (configured || (await getInstances()).length) > 0) {
    throw new Error(`${scope}: an instance did not answer`);
  }
}

const POLL_SOURCE_TIMEOUT_MS: Record<string, number> = {
  // Allow the shared two-slot limiter to rotate across all three Arr families.
  // The active-source marker remains until timed-out work actually settles, and
  // cache warming is suppressed while any such work is still in flight.
  pollSonarr: 180_000,
  pollRadarr: 180_000,
  pollLidarr: 180_000,
  pollQBittorrent: 45_000,
  pollJellyfin: 15_000,
  pollSeerr: 45_000,
  pollProwlarr: 45_000,
  pollManualDownloads: 60_000,
  pollTwitch: 25_000,
  pollServiceReachability: 15_000,
  checkDiskSpace: 30_000,
  snapshotDiskUsage: 30_000,
  checkUpcoming: 45_000,
  refreshScheduledAlertOccurrences: 60_000,
  checkScheduledAlerts: 30_000,
  checkActivityDigest: 30_000,
  applyBandwidthSchedule: 15_000,
  checkRetention: 60_000,
  checkAnimeAutoMap: 15_000,
  sweepTasteProfiles: 120_000,
  warmCaches: 60_000,
};

/** One background job's latest outcome, for the admin status view. */
export interface PollingSourceHealth {
  source: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  /** Set while the job is running; a job far past its timeout is stuck. */
  runningSince: string | null;
}

export interface PollingHealth {
  running: boolean;
  intervalMs: number | null;
  cycleInProgress: boolean;
  lastCycle: { finishedAt: string; durationMs: number; failed: number } | null;
  sources: PollingSourceHealth[];
}

type SourceOutcome = { source: string; status: 'fulfilled' | 'rejected' | 'skipped'; error?: string };

/**
 * Fold one cycle's outcomes into the per-source record. A job skipped because
 * its previous run is still going is neither a success nor a failure, so a hung
 * job does not look healthy.
 */
export function nextSourceHealth(
  previous: ReadonlyMap<string, Omit<PollingSourceHealth, 'source' | 'runningSince'>>,
  outcomes: SourceOutcome[],
  at: string,
): Map<string, Omit<PollingSourceHealth, 'source' | 'runningSince'>> {
  const next = new Map(previous);
  for (const outcome of outcomes) {
    const entry = { ...(next.get(outcome.source) ?? { lastSuccessAt: null, lastFailureAt: null, lastError: null }) };
    if (outcome.status === 'fulfilled') entry.lastSuccessAt = at;
    if (outcome.status === 'rejected') {
      entry.lastFailureAt = at;
      // Shown to admins: redacted like log output.
      entry.lastError = String(redact(outcome.error ?? 'Unknown error')).slice(0, 300);
    }
    next.set(outcome.source, entry);
  }
  return next;
}

export class PollingService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private currentIntervalMs: number | null = null;
  private isPolling = false;
  private pollPending = false;
  // Handle on the running cycle so shutdown can drain it (bounded) instead of
  // killing DB/notification writes mid-flight.
  private currentPoll: Promise<void> | null = null;
  private activePollSources = new Set<string>();
  private sourceStartedAt = new Map<string, string>();
  private sourceHealth = new Map<string, Omit<PollingSourceHealth, 'source' | 'runningSince'>>();
  private lastCycle: PollingHealth['lastCycle'] = null;
  // Epoch ms of the last retention sweep. The poll loop runs every ~30s but
  // the sweep is throttled to once/day; 0 = run on first cycle.
  private lastRetentionPruneAt = 0;
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
    this.intervalId = setInterval(() => {
      this.currentPoll = this.poll();
    }, intervalMs);
    this.currentPoll = this.poll();
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

  private async runPollSource(source: string, fn: () => Promise<void>, report?: JobReport): Promise<void> {
    if (this.activePollSources.has(source)) {
      logger.warn('Polling source skipped: previous run still active', { source }, { scope: 'polling' });
      if (report) report.skipped = true;
      return;
    }
    this.activePollSources.add(source);
    this.sourceStartedAt.set(source, new Date().toISOString());
    const timeoutMs = source in POLL_SOURCE_TIMEOUT_MS
      ? POLL_SOURCE_TIMEOUT_MS[source]
      : 45_000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const task = (report ? jobReports.run(report, fn) : fn()).finally(() => {
      this.activePollSources.delete(source);
      this.sourceStartedAt.delete(source);
      if (timer) clearTimeout(timer);
    });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        logger.warn('Polling source timed out', { source, timeoutMs }, { scope: 'polling' });
        reject(new Error(`Polling source timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    await Promise.race([task, timeout]);
  }

  private async poll(): Promise<void> {
    if (this.isPolling) {
      this.pollPending = true;
      logger.warn('Polling cycle skipped: previous cycle still running', {}, { scope: 'polling' });
      return;
    }
    this.isPolling = true;
    try {
      const startedAt = performance.now();
      const context = createPollingCycleContext(getOrCreateAppSettings, {
        instanceConcurrency: 2,
      });
      const reports = new Map<string, JobReport>();
      const sourceTask = (
        source: string,
        run: () => Promise<void>,
      ): { source: string; run: () => Promise<void> } => {
        const report: JobReport = { failure: null, skipped: false };
        reports.set(source, report);
        return {
          source,
          run: () => context.runSource(
            source,
            () => this.runPollSource(source, run, report),
          ),
        };
      };
      const pollTasks: Array<{ source: string; run: () => Promise<void> }> = [
        sourceTask('pollSonarr', () => this.pollSonarr(context)),
        sourceTask('pollRadarr', () => this.pollRadarr(context)),
        sourceTask('pollLidarr', () => this.pollLidarr(context)),
        sourceTask('pollQBittorrent', () => this.pollQBittorrent(context)),
        sourceTask('pollJellyfin', () => this.pollJellyfin()),
        sourceTask('pollSeerr', () => this.pollSeerr()),
        sourceTask('pollProwlarr', () => this.pollProwlarr()),
        sourceTask('pollManualDownloads', () => this.pollManualDownloads()),
        sourceTask('pollTwitch', () => pollTwitch()),
        sourceTask('pollServiceReachability', () => this.pollServiceReachability()),
        sourceTask('checkDiskSpace', () => this.checkDiskSpace(context)),
        sourceTask('snapshotDiskUsage', async () => {
          if (await this.shouldSnapshotDiskUsage(context)) {
            await this.snapshotDiskUsage(context);
          } else {
            noteJobSkipped();
          }
        }),
      ];
      pollTasks.push(
        sourceTask('checkUpcoming', () => this.checkUpcoming(context)),
        sourceTask('refreshScheduledAlertOccurrences', () => refreshScheduledAlertOccurrences()),
        sourceTask('checkScheduledAlerts', () => checkScheduledAlerts()),
        sourceTask('checkActivityDigest', () => this.checkActivityDigest(context)),
        sourceTask('applyBandwidthSchedule', () => this.applyBandwidthSchedule(context)),
        sourceTask('checkRetention', () => this.checkRetention(context)),
        sourceTask('checkAnimeAutoMap', () => this.checkAnimeAutoMap(context)),
        sourceTask('sweepTasteProfiles', () => this.sweepTasteProfiles()),
      );
      const pollSources = pollTasks.map((task) => task.source);
      // Still running from an earlier cycle: runPollSource skips these.
      const skipped = new Set(pollSources.filter((source) => this.activePollSources.has(source)));
      logger.debug('Polling cycle started', {
        cycleId: context.id,
        sources: pollSources,
      }, { scope: 'polling' });
      const results = await Promise.allSettled(pollTasks.map((task) => task.run()));

      // Warm AFTER the polls: pollSonarr/Radarr/Lidarr invalidate the library
      // cache when they observe an import, and a warm fetch racing them could
      // write a pre-import snapshot back over that invalidation for the TTL.
      const activeArrSources = ['pollSonarr', 'pollRadarr', 'pollLidarr']
        .filter((source) => this.activePollSources.has(source));
      const warmReport: JobReport = { failure: null, skipped: false };
      reports.set('warmCaches', warmReport);
      if (activeArrSources.length === 0) {
        await context.runSource(
          'warmCaches',
          () => this.runPollSource('warmCaches', () => this.warmCaches(), warmReport),
        ).catch((e) => {
          warmReport.failure ??= errorMessage(e);
          logger.error('Cache warming failed', e, { scope: 'polling' });
        });
      } else {
        warmReport.skipped = true;
        logger.warn('Cache warming skipped: Arr polling still active', {
          sources: activeArrSources,
        }, { scope: 'polling' });
      }

      const rejected = results.flatMap((result, index) => {
        if (result.status !== 'rejected') return [];
        return [{ source: pollSources[index], reason: errorMessage(result.reason) }];
      });
      const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
      const finishedAt = new Date().toISOString();
      // A job counts as failed if it threw or logged a failure and carried on.
      const outcomes: SourceOutcome[] = results.map((result, index) => {
        const source = pollSources[index];
        const report = reports.get(source);
        if (skipped.has(source)) return { source, status: 'skipped' };
        if (result.status === 'rejected') return { source, status: 'rejected', error: errorMessage(result.reason) };
        if (report?.failure) return { source, status: 'rejected', error: report.failure };
        return { source, status: report?.skipped ? 'skipped' : 'fulfilled' };
      });
      outcomes.push(warmReport.failure
        ? { source: 'warmCaches', status: 'rejected', error: warmReport.failure }
        : { source: 'warmCaches', status: warmReport.skipped ? 'skipped' : 'fulfilled' });
      this.sourceHealth = nextSourceHealth(this.sourceHealth, outcomes, finishedAt);
      this.lastCycle = { finishedAt, durationMs, failed: outcomes.filter((outcome) => outcome.status === 'rejected').length };
      const cycleMetrics = context.getMetrics();
      logger.debug('Polling cycle completed', {
        cycleId: context.id,
        durationMs,
        settingsReadCount: cycleMetrics.settingsReadCount,
        maxInstanceConcurrency: cycleMetrics.maxInstanceConcurrency,
        instanceFailures: cycleMetrics.instanceFailures,
        sourceDurationsMs: cycleMetrics.sourceDurationsMs,
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
      if (this.pollPending) {
        this.pollPending = false;
        // Only re-run while the service is still running — after stop() this
        // would start a fresh cycle mid-shutdown.
        if (this.intervalId) {
          this.currentPoll = this.poll();
        }
      }
    }
  }

  /** Await the in-flight polling cycle, if any. Never rejects — poll() logs its own failures. */
  async awaitInFlightPoll(): Promise<void> {
    if (this.currentPoll) {
      try {
        await this.currentPoll;
      } catch {
        /* logged inside poll() */
      }
    }
  }

  /** Whether polling runs and how each background job last went, for administrators. */
  getHealth(): PollingHealth {
    const names = new Set([...this.sourceHealth.keys(), ...this.sourceStartedAt.keys()]);
    return {
      running: this.intervalId !== null,
      intervalMs: this.currentIntervalMs,
      cycleInProgress: this.isPolling,
      lastCycle: this.lastCycle,
      sources: [...names].sort().map((source) => ({
        source,
        ...(this.sourceHealth.get(source) ?? { lastSuccessAt: null, lastFailureAt: null, lastError: null }),
        runningSince: this.sourceStartedAt.get(source) ?? null,
      })),
    };
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
      noteJobFailure(error);
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
    reason: 'manual' | 'scheduled',
    cycleSettings?: AppSettingsSnapshot,
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

    let queue: Array<{ instanceId: string; series: SonarrSeries }>;
    try {
      const settings = cycleSettings ?? await getOrCreateAppSettings();
      // The toggle governs the nightly schedule only — a manual Run-now is
      // always allowed. (checkAnimeAutoMap already gates scheduled starts;
      // this is defense-in-depth.)
      if (!settings.animeAutoMapEnabled && reason === 'scheduled') {
        this.animeMapRun = null;
        return { started: false, reason: 'disabled' };
      }

      // Fan out per Sonarr instance: each series id is only "already mapped" within
      // its own instance, so scope the lookup by sonarrInstanceId and queue per instance.
      queue = [];
      for (const { connection, client } of await getSonarrClients()) {
        const anime = (await client.getSeries()).filter((s) => s.seriesType === 'anime');
        const rows = await prisma.aniListSeriesMapping.findMany({
          where: { sonarrInstanceId: connection.id, sonarrSeriesId: { in: anime.map((s) => s.id) } },
          select: { sonarrSeriesId: true },
        });
        const mappedIds = new Set(rows.map((row) => row.sonarrSeriesId));
        for (const s of anime) {
          if (!mappedIds.has(s.id)) queue.push({ instanceId: connection.id, series: s });
        }
      }
    } catch (error) {
      // Sonarr/DB unavailable — release the claim WITHOUT stamping, so being
      // down at the scheduled hour doesn't consume the day; a later poll retries.
      this.animeMapRun = null;
      noteJobFailure(error);
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
  private async runAnimeAutoMapLoop(queue: Array<{ instanceId: string; series: SonarrSeries }>): Promise<void> {
    const run = this.animeMapRun;
    if (!run) return;
    try {
      for (let i = 0; i < queue.length; i++) {
        if (run.stop) break;
        const { instanceId, series } = queue[i];
        run.currentTitle = series.title;

        // A row may have appeared since the queue was built (manual map, page
        // visit, doubled dev loop) — never re-touch an existing mapping.
        const existing = await prisma.aniListSeriesMapping.findUnique({
          where: { sonarrInstanceId_sonarrSeriesId: { sonarrInstanceId: instanceId, sonarrSeriesId: series.id } },
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
        const attemptStartedMs = Date.now();
        while (!done && !run.stop) {
          try {
            await ensureSeriesAniListMapping(series, instanceId);
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

  // Keep the hot library caches warm so a user opening the app hits Redis
  // instead of a live *arr fan-out. These are the exact loaders (scope + seed)
  // the /api/{sonarr,radarr,lidarr} library routes use, so a warm entry serves
  // them directly; when already warm each is one Redis GET. The activity queue
  // is deliberately NOT warmed: its 5s TTL expires long before the next 30s
  // cycle, so warming it would cost a full fan-out for a mostly-dead entry.
  // Keeps recently-active users' taste profiles warm so /recommendations is a
  // cache hit instead of a multi-service scan on first open. Self-throttled;
  // rebuilds run sequentially and are capped per sweep (the tail drains over
  // subsequent sweeps). Lazy rebuild on read remains the correctness backstop —
  // this is purely a latency optimization.
  private lastTasteProfileSweepAt = 0;
  private async sweepTasteProfiles(): Promise<void> {
    const now = Date.now();
    if (now - this.lastTasteProfileSweepAt < TASTE_PROFILE_SWEEP_INTERVAL_MS) { noteJobSkipped(); return; }
    this.lastTasteProfileSweepAt = now;

    const activeCutoff = new Date(now - TASTE_PROFILE_ACTIVE_WINDOW_MS);
    const staleBefore = new Date(now - PROFILE_MAX_AGE_MS);
    const users = await prisma.user.findMany({
      where: {
        status: 'active',
        sessions: { some: { lastSeenAt: { gte: activeCutoff }, revokedAt: null } },
      },
      select: {
        id: true,
        role: true,
        template: true,
        permissions: true,
        jellyfinUserId: true,
        tasteProfile: { select: { builtAt: true, version: true } },
      },
    });

    const due = users
      // Only users who can actually see recommendations — rebuilding a
      // profile nobody can read wastes Jellyfin/AniList calls every sweep.
      .filter((user) => can(user, 'recommendations.view'))
      .filter((user) =>
        !user.tasteProfile
        || user.tasteProfile.version !== PROFILE_VERSION
        || user.tasteProfile.builtAt < staleBefore
      )
      .slice(0, TASTE_PROFILE_MAX_REBUILDS_PER_SWEEP);

    for (const user of due) {
      try {
        await rebuildTasteProfile(user);
      } catch (error) {
        noteJobFailure(error);
        logger.warn('Taste profile rebuild failed', {
          userId: user.id,
          reason: errorMessage(error),
        }, { scope: 'polling' });
      }
    }
  }

  private async warmCaches(): Promise<void> {
    // allSettled + per-scope logging: one failing scope must not abort or mask
    // the other warmups.
    const warms = [
      { scope: 'sonarr', run: () => warmLibrary('sonarr', getSonarrClients, (c) => c.getSeries()) },
      { scope: 'radarr', run: () => warmLibrary('radarr', getRadarrClients, (c) => c.getMovies()) },
      { scope: 'lidarr', run: () => warmLibrary('lidarr', getLidarrClients, (c) => c.getArtists()) },
    ] as const;
    const results = await Promise.allSettled(warms.map((w) => w.run()));
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        noteJobFailure(result.reason);
        logger.warn('Cache warm failed', { scope: warms[i].scope, reason: errorMessage(result.reason) }, { scope: 'polling' });
      }
    });
  }

  // Daily anime auto-map scheduling gate. The run itself lives on a detached
  // loop (startAnimeAutoMapRun); this only decides "is it time tonight?" —
  // first poll at/after the configured local hour, once per local calendar
  // day. Catch-up style: a server that was off at the hour still runs on its
  // next poll that day. Toggling the setting off prevents the next scheduled
  // run but doesn't kill an in-flight one (Stop is the halt control).
  private async checkAnimeAutoMap(context: CycleContext): Promise<void> {
    if (this.animeMapRun) return;
    const settings = await context.getSettings();
    if (!settings.animeAutoMapEnabled) return;

    const timeZone = settings.timeZone;
    const now = new Date(context.startedAtMs);
    // Not due yet, or already run today: nothing to do this cycle.
    if (toZonedDate(now, timeZone).getHours() < settings.animeAutoMapHour) { noteJobSkipped(); return; }
    const lastRun = settings.animeAutoMapLastRunAt;
    if (lastRun && getLocalDateKey(lastRun, timeZone) === getLocalDateKey(now, timeZone)) { noteJobSkipped(); return; }

    // Awaited: building the queue is this job's work (and its failure); the
    // mapping loop it starts runs on detached.
    await this.startAnimeAutoMapRun('scheduled', settings).catch((error) => {
      noteJobFailure(error);
      logger.error('Anime auto-map scheduled start failed', {
        error: errorMessage(error),
      }, { scope: 'polling' });
    });
  }

  private pollServiceReachability() {
    return pollServiceReachabilityPoller();
  }

  private checkDiskSpace(context: CycleContext) {
    return checkDiskSpacePoller(context);
  }

  private async shouldSnapshotDiskUsage(context: CycleContext): Promise<boolean> {
    const settings = await context.getSettings();
    const capturedDate = localDateOnly(new Date(context.startedAtMs), settings.timeZone);
    const existing = await prisma.diskUsageSnapshot.findFirst({
      where: { capturedDate },
      select: { id: true },
    });
    return existing === null;
  }

  // Daily disk-usage history powering the storage widget's trend + days-until-full.
  // The poll cycle gates this before external disk API calls once today's snapshot exists.
  // Independent of checkDiskSpace (which early-returns when no thresholds are set).
  private async snapshotDiskUsage(context: CycleContext): Promise<void> {
    const now = new Date(context.startedAtMs);
    let disks;
    try {
      disks = await getAggregatedDiskSpace();
    } catch (error) {
      noteJobFailure(error);
      logger.debug('Disk-usage snapshot skipped: could not read disk space', {
        error: errorMessage(error),
      }, { scope: 'polling' });
      return;
    }
    if (disks.length === 0) return;

    const settings = await context.getSettings();
    const capturedDate = localDateOnly(now, settings.timeZone);

    const todays = await prisma.diskUsageSnapshot.findMany({
      where: { capturedDate },
      select: { diskId: true },
    });
    const capturedToday = new Set(todays.map((row) => row.diskId));

    const pending = disks.filter((disk) => !capturedToday.has(diskId(disk)));
    if (pending.length > 0) {
      await prisma.diskUsageSnapshot.createMany({
        data: pending.map((disk) => ({
          diskId: diskId(disk),
          label: disk.label || null,
          path: disk.path,
          totalSpace: BigInt(Math.round(disk.totalSpace)),
          freeSpace: BigInt(Math.round(disk.freeSpace)),
          capturedAt: now,
          capturedDate,
        })),
        skipDuplicates: true,
      });

      const cutoff = new Date(context.startedAtMs - DISK_SNAPSHOT_RETENTION_MS);
      await prisma.diskUsageSnapshot.deleteMany({ where: { capturedAt: { lt: cutoff } } });
    }
  }

  private pollSonarr(context: CycleContext) {
    return pollSonarrPoller(context);
  }

  private pollRadarr(context: CycleContext) {
    return pollRadarrPoller(context);
  }

  private pollLidarr(context: CycleContext) {
    return pollLidarrPoller(context);
  }

  private pollQBittorrent(context: CycleContext) {
    return pollQBittorrentPoller(context);
  }

  private pollJellyfin() {
    return pollJellyfinPoller();
  }

  /** Manual downloads after their grab: Arr's queue, history and files decide (see manual-downloads/status). */
  private async pollManualDownloads() {
    await reconcileManualDownloads();
  }

  private pollSeerr() {
    return pollSeerrPoller();
  }

  private pollProwlarr() {
    return pollProwlarrPoller();
  }

  private checkUpcoming(context: CycleContext) {
    return checkUpcomingPoller(context);
  }

  // Run bounded database and image-cache retention once/day. Database errors
  // leave the throttle untouched so a later poll retries; image cleanup fails
  // independently so Redis/filesystem trouble cannot block database pruning.
  private async checkRetention(context: CycleContext): Promise<void> {
    const now = context.startedAtMs;
    if (now - this.lastRetentionPruneAt < 86_400_000) { noteJobSkipped(); return; }

    const settings = await context.getSettings();
    const result = await runRetentionSweep({
      notificationRetentionDays: settings.notificationHistoryRetentionDays,
      nowMs: now,
    });

    // Advance the throttle only after a successful sweep, so a transient DB
    // error retries on the next cycle instead of being skipped for a full day.
    this.lastRetentionPruneAt = now;

    if (result.imageCache.status === 'failed') {
      noteJobFailure(result.imageCache.message);
      logger.warn('Image-cache retention failed', {
        message: result.imageCache.message,
      }, { scope: 'polling' });
    }

    const databaseDeleted = Object.values(result.counts).reduce((sum, count) => sum + count, 0);
    const imageDeleted = result.imageCache.status === 'completed'
      ? result.imageCache.deletedFiles
      : 0;
    if (databaseDeleted > 0 || imageDeleted > 0) {
      logger.info('Pruned expired runtime data', {
        ...result.counts,
        notificationRetentionDays: result.notificationRetentionDays,
        imageFiles: imageDeleted,
        imageBytes: result.imageCache.status === 'completed'
          ? result.imageCache.deletedBytes
          : 0,
        imageGenerations: result.imageCache.status === 'completed'
          ? result.imageCache.deletedGenerations
          : 0,
      }, { scope: 'polling' });
    }
  }

  private checkActivityDigest(context: CycleContext) {
    return checkActivityDigestPoller(context);
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
      if (!(error instanceof ConfigurationError)) noteJobFailure(error);
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
      noteJobFailure(error);
      logger.warn('Failed to restore bandwidth', {
        context,
        previousRuleId: previous.ruleId,
        error,
      }, { scope: 'polling' });
    }
  }

  private async applyBandwidthSchedule(context: CycleContext): Promise<void> {
    const settings = await context.getSettings();
    const schedule = parseBandwidthSchedule(settings.qbtBandwidthSchedule);
    if (schedule.rules.length === 0) {
      // No rules (or all deleted). Release any throttle we applied so the limit
      // lifts; if we never applied one, this leaves the user's settings alone.
      await this.releaseAppliedBandwidth('schedule-empty');
      return;
    }

    const active = pickActiveRule(
      schedule.rules,
      new Date(context.startedAtMs),
      settings.timeZone,
    );

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
      if (!(error instanceof ConfigurationError)) noteJobFailure(error);
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
      noteJobFailure(error);
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
