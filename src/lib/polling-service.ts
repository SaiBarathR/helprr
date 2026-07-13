import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getSonarrClients, getRadarrClients, getLidarrClients, getQBittorrentClient, getJellyfinClient, getSeerrClient } from '@/lib/service-helpers';
import {
  getAggregatedDiskSpace,
  diskId,
  parseDiskThresholds,
  parseDiskAlertState,
  diskAlertStateEqual,
  type DiskAlertState,
} from '@/lib/disk-space';
import { getDefaultConnection } from '@/lib/arr-instances';
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
import { refreshScheduledAlertOccurrences, checkScheduledAlerts } from '@/lib/scheduled-alerts/delivery';
import { classifyQueueIssue } from '@/lib/queue-state';
import { writeBadgeSlice } from '@/lib/cache/badge-counts';
import { reconcileManualDownloads } from '@/lib/manual-downloads';
import { getCachedTaggedLibrary, invalidateTaggedLibrary } from '@/lib/cache/tagged-library';
import { probeServiceHealth, SERVICE_LABELS } from '@/lib/service-health';
import {
  PollNotificationCollector,
  type NotificationEventInput,
  type PollNotificationContext,
} from '@/lib/notification-grouping';
import type { QueueItem, QueueResponse, SonarrSeries, Tag } from '@/types';
import crypto from 'crypto';

// Tolerance (minutes) for the "before_air" firing window. Lets a sluggish poll
// still catch an item that just slipped past its computed notify time —
// important for the "0 min / at air time" case, where the notify moment is
// the air moment itself.
const BEFORE_AIR_GRACE_MIN = 5;
// Extra calendar fetch padding past notifyBeforeMins so an item near the upper
// edge isn't excluded by clock skew between us and Sonarr/Radarr.
const FETCH_END_BUFFER_MS = 60_000;

// While a disk stays below its threshold, re-remind at most this often. Reset on
// recovery, so a later drop alerts immediately rather than waiting out the window.
const DISK_ALERT_REMINDER_MS = 6 * 60 * 60 * 1000; // 6 hours

// How long daily disk-usage snapshots are kept (the trend only needs ~7 days,
// but a longer tail makes the growth-rate fit more stable + survives gaps).
const DISK_SNAPSHOT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

// How long CleanupHistory and settled ScheduledAlertOccurrence rows are kept.
// Both tables otherwise grow unbounded: auto-run cleaners write rows every
// cycle (including skipped/dryRunPreview), and a standing episode/airing alert
// accrues one terminal occurrence row per episode forever.
const AUDIT_HISTORY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

function localDateOnly(input: Date, timeZone: string): Date {
  return new Date(`${getLocalDateKey(input, timeZone)}T00:00:00.000Z`);
}

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

// Per-instance, per-cycle tag-id → label map so queue/history notifications can
// carry the human tag labels their owning series/movie/artist holds. The tag
// list is small, so this is one cheap call per service instance. A failure
// yields an empty map (tags simply won't be available for filtering that cycle).
async function buildTagMap(client: { getTags: () => Promise<Tag[]> }): Promise<Map<number, string>> {
  try {
    const tags = await client.getTags();
    return new Map(tags.map((t) => [t.id, t.label]));
  } catch {
    return new Map();
  }
}

// Quality name + resolved tag labels for a queue/history item, attached to the
// notification metadata so NotificationPreference.tagFilter/qualityFilter can
// gate it in notifyEvent(). The nested series/movie/artist (which carry the
// numeric tag ids) are already included on queue/history records via the
// includeSeries/includeMovie request params.
function mediaFilterMeta(
  item: {
    quality?: { quality?: { name?: string } };
    series?: { tags?: number[] };
    movie?: { tags?: number[] };
    artist?: { tags?: number[] };
  },
  tagMap: Map<number, string>,
): { qualityName?: string; tags?: string[] } {
  const qualityName = item.quality?.quality?.name;
  const tagIds = item.series?.tags ?? item.movie?.tags ?? item.artist?.tags ?? [];
  const tags = tagIds
    .map((id) => tagMap.get(id))
    .filter((label): label is string => Boolean(label));
  return {
    ...(qualityName ? { qualityName } : {}),
    ...(tags.length ? { tags } : {}),
  };
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

// (lastHistoryDate, lastHistoryId, lastHistorySeenIds) is a keyset cursor over *arr
// history. Paginate until the cursor boundary is reached so bursts at a shared
// timestamp or >50 rows per cycle cannot be skipped.
const HISTORY_PAGE_SIZE = 50;
const HISTORY_MAX_PAGES = 20;
const HISTORY_SEEN_ID_CAP = 500;

const POLL_SOURCE_TIMEOUT_MS: Record<string, number> = {
  pollSonarr: 60_000,
  pollRadarr: 60_000,
  pollLidarr: 60_000,
  pollQBittorrent: 45_000,
  pollJellyfin: 15_000,
  pollSeerr: 45_000,
  pollServiceReachability: 15_000,
  checkDiskSpace: 30_000,
  snapshotDiskUsage: 30_000,
  checkUpcoming: 45_000,
  refreshScheduledAlertOccurrences: 60_000,
  checkScheduledAlerts: 30_000,
  checkActivityDigest: 30_000,
  applyBandwidthSchedule: 15_000,
  checkNotificationRetention: 15_000,
  checkAnimeAutoMap: 15_000,
  warmCaches: 60_000,
};

type HistoryCursorState = {
  lastHistoryDate: Date | null;
  lastHistoryId: number | null;
  lastHistorySeenIds: number[];
};

function parseSeenIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
}

// A null lastQueueIds is the first-run marker: the queue baseline only exists
// once a queue poll has stored its snapshot, so until then pre-existing
// queue/torrent items must baseline silently instead of firing a burst of
// stale "new item" pushes (initial setup, connection re-add). Row existence
// alone is NOT a baseline — pollServiceReachability upserts the row in the
// same cycle, racing the queue pollers. History polling already baselines via
// the null cursor; this covers the queue/torrent diffing. pollSeerr keeps its
// own equivalent guard.
async function getPollingState(serviceConnectionId: string) {
  const existing = await prisma.pollingState.findUnique({ where: { serviceConnectionId } });
  if (existing) return { state: existing, firstRun: existing.lastQueueIds === null };
  const state = await prisma.pollingState.create({ data: { serviceConnectionId } });
  return { state, firstRun: true };
}

function historyCursorFromState(state: {
  lastHistoryDate: Date | null;
  lastHistoryId: number | null;
  lastHistorySeenIds?: unknown;
}): HistoryCursorState {
  return {
    lastHistoryDate: state.lastHistoryDate,
    lastHistoryId: state.lastHistoryId,
    lastHistorySeenIds: parseSeenIds(state.lastHistorySeenIds),
  };
}

function filterNewHistory<T extends { id: number; date: string }>(
  records: T[],
  cursor: HistoryCursorState,
): T[] {
  if (!cursor.lastHistoryDate) return [];
  const lastTime = cursor.lastHistoryDate.getTime();
  const seen = new Set(cursor.lastHistorySeenIds);
  return records.filter((r) => {
    const time = new Date(r.date).getTime();
    if (time > lastTime) return true;
    if (time < lastTime) return false;
    if (seen.has(r.id)) return false;
    return cursor.lastHistoryId === null || r.id > cursor.lastHistoryId;
  });
}

async function fetchNewHistoryPages<T extends { id: number; date: string }>(
  client: {
    getHistory: (
      page: number,
      pageSize: number,
      sortKey: string,
      sortDir: string,
    ) => Promise<{ records: T[] }>;
  },
  cursor: HistoryCursorState,
): Promise<{ allFetched: T[]; newRecords: T[] }> {
  const allFetched: T[] = [];
  let capped = false;
  for (let page = 1; page <= HISTORY_MAX_PAGES; page++) {
    const batch = await client.getHistory(page, HISTORY_PAGE_SIZE, 'date', 'descending');
    if (batch.records.length === 0) break;
    allFetched.push(...batch.records);

    if (!cursor.lastHistoryDate) break;

    const oldest = batch.records[batch.records.length - 1];
    const oldestTime = new Date(oldest.date).getTime();
    const cursorTime = cursor.lastHistoryDate.getTime();

    if (oldestTime < cursorTime) break;

    if (oldestTime === cursorTime) {
      const seen = new Set(cursor.lastHistorySeenIds);
      const pageFullyKnown = batch.records.every((r) => {
        const t = new Date(r.date).getTime();
        if (t > cursorTime) return false;
        if (t < cursorTime) return true;
        return seen.has(r.id) || (cursor.lastHistoryId !== null && r.id <= cursor.lastHistoryId);
      });
      if (pageFullyKnown) break;
    }

    if (page === HISTORY_MAX_PAGES) capped = true;
  }

  if (capped) {
    logger.warn('History pagination capped before reaching cursor', {
      collected: allFetched.length,
      pageSize: HISTORY_PAGE_SIZE,
      maxPages: HISTORY_MAX_PAGES,
      lastHistoryDate: cursor.lastHistoryDate,
      lastHistoryId: cursor.lastHistoryId,
    }, { scope: 'polling' });
  }
  return { allFetched, newRecords: filterNewHistory(allFetched, cursor) };
}

function advanceHistoryCursor(
  processed: { id: number; date: string }[],
  allFetched: { id: number; date: string }[],
  prev: HistoryCursorState,
): { lastHistoryDate: Date | null; lastHistoryId: number | null; lastHistorySeenIds: number[] } {
  if (!prev.lastHistoryDate && allFetched.length > 0 && processed.length === 0) {
    const newestDate = new Date(allFetched[0].date);
    const newestTime = newestDate.getTime();
    let maxId: number | null = null;
    const idsAtDate: number[] = [];
    for (const r of allFetched) {
      if (new Date(r.date).getTime() !== newestTime) break;
      idsAtDate.push(r.id);
      if (maxId === null || r.id > maxId) maxId = r.id;
    }
    return {
      lastHistoryDate: newestDate,
      lastHistoryId: maxId,
      lastHistorySeenIds: idsAtDate.sort((a, b) => a - b).slice(-HISTORY_SEEN_ID_CAP),
    };
  }

  if (processed.length === 0) {
    return {
      lastHistoryDate: prev.lastHistoryDate,
      lastHistoryId: prev.lastHistoryId,
      lastHistorySeenIds: prev.lastHistorySeenIds,
    };
  }

  let nextDate = prev.lastHistoryDate;
  let nextId = prev.lastHistoryId;
  for (const r of processed) {
    const d = new Date(r.date);
    if (!nextDate) {
      nextDate = d;
      nextId = r.id;
      continue;
    }
    const dt = d.getTime();
    const nt = nextDate.getTime();
    if (dt > nt || (dt === nt && (nextId === null || r.id > nextId))) {
      nextDate = d;
      nextId = r.id;
    }
  }

  if (!nextDate) {
    return {
      lastHistoryDate: prev.lastHistoryDate,
      lastHistoryId: prev.lastHistoryId,
      lastHistorySeenIds: prev.lastHistorySeenIds,
    };
  }

  const boundaryTime = nextDate.getTime();
  const idsAtBoundary = allFetched
    .filter((r) => new Date(r.date).getTime() === boundaryTime)
    .map((r) => r.id);
  return {
    lastHistoryDate: nextDate,
    lastHistoryId: nextId,
    lastHistorySeenIds: [...new Set(idsAtBoundary)].sort((a, b) => a - b).slice(-HISTORY_SEEN_ID_CAP),
  };
}

function getMediaHrefFromIds(args: {
  seriesId?: unknown;
  seasonNumber?: unknown;
  episodeId?: unknown;
  movieId?: unknown;
  albumId?: unknown;
  artistId?: unknown;
  instanceId?: unknown;
}): string | null {
  // Keep the deep-link on the instance the event came from; detail pages read
  // ?instance and fall back to the default when it's absent.
  const instance = typeof args.instanceId === 'string' && args.instanceId ? args.instanceId : null;
  const withInstance = (href: string) => (instance ? `${href}?instance=${instance}` : href);

  const movieId = toNumber(args.movieId);
  if (movieId) return withInstance(`/movies/${movieId}`);

  const albumId = toNumber(args.albumId);
  if (albumId) return withInstance(`/music/album/${albumId}`);
  const artistId = toNumber(args.artistId);
  if (artistId) return withInstance(`/music/${artistId}`);

  const seriesId = toNumber(args.seriesId);
  const seasonNumber = toNumber(args.seasonNumber);
  const episodeId = toNumber(args.episodeId);
  if (seriesId && seasonNumber && episodeId) {
    return withInstance(`/series/${seriesId}/season/${seasonNumber}/episode/${episodeId}`);
  }
  if (seriesId && seasonNumber) {
    return withInstance(`/series/${seriesId}/season/${seasonNumber}`);
  }
  if (seriesId) {
    return withInstance(`/series/${seriesId}`);
  }
  return null;
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
  ): Promise<number | null> {
    try {
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
    } catch (err) {
      logger.warn('Polling notification failed', {
        ...context,
        eventType: event.eventType,
        title: event.title,
        reason: err instanceof Error ? err.message : String(err),
      }, { scope: 'polling' });
      return null;
    }
  }

  /** Prefix a notification title with the instance label only when >1 instance of the type is connected. */
  private instanceTitle(base: string, label: string, instanceCount: number): string {
    return instanceCount > 1 ? `${label} · ${base}` : base;
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

  private async runPollSource(source: string, fn: () => Promise<void>): Promise<void> {
    if (this.activePollSources.has(source)) {
      logger.warn('Polling source skipped: previous run still active', { source }, { scope: 'polling' });
      return;
    }
    this.activePollSources.add(source);
    const timeoutMs = POLL_SOURCE_TIMEOUT_MS[source] ?? 45_000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const task = fn().finally(() => {
      this.activePollSources.delete(source);
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
      const pollTasks: Array<{ source: string; run: () => Promise<void> }> = [
        { source: 'pollSonarr', run: () => this.runPollSource('pollSonarr', () => this.pollSonarr()) },
        { source: 'pollRadarr', run: () => this.runPollSource('pollRadarr', () => this.pollRadarr()) },
        { source: 'pollLidarr', run: () => this.runPollSource('pollLidarr', () => this.pollLidarr()) },
        { source: 'pollQBittorrent', run: () => this.runPollSource('pollQBittorrent', () => this.pollQBittorrent()) },
        { source: 'pollJellyfin', run: () => this.runPollSource('pollJellyfin', () => this.pollJellyfin()) },
        { source: 'pollSeerr', run: () => this.runPollSource('pollSeerr', () => this.pollSeerr()) },
        { source: 'pollServiceReachability', run: () => this.runPollSource('pollServiceReachability', () => this.pollServiceReachability()) },
        { source: 'checkDiskSpace', run: () => this.runPollSource('checkDiskSpace', () => this.checkDiskSpace()) },
      ];
      if (await this.shouldSnapshotDiskUsage()) {
        pollTasks.push({ source: 'snapshotDiskUsage', run: () => this.runPollSource('snapshotDiskUsage', () => this.snapshotDiskUsage()) });
      }
      pollTasks.push(
        { source: 'checkUpcoming', run: () => this.runPollSource('checkUpcoming', () => this.checkUpcoming()) },
        { source: 'refreshScheduledAlertOccurrences', run: () => this.runPollSource('refreshScheduledAlertOccurrences', () => refreshScheduledAlertOccurrences()) },
        { source: 'checkScheduledAlerts', run: () => this.runPollSource('checkScheduledAlerts', () => checkScheduledAlerts()) },
        { source: 'checkActivityDigest', run: () => this.runPollSource('checkActivityDigest', () => this.checkActivityDigest()) },
        { source: 'applyBandwidthSchedule', run: () => this.runPollSource('applyBandwidthSchedule', () => this.applyBandwidthSchedule()) },
        { source: 'checkNotificationRetention', run: () => this.runPollSource('checkNotificationRetention', () => this.checkNotificationRetention()) },
        { source: 'checkAnimeAutoMap', run: () => this.runPollSource('checkAnimeAutoMap', () => this.checkAnimeAutoMap()) },
      );
      const pollSources = pollTasks.map((task) => task.source);
      logger.debug('Polling cycle started', { sources: pollSources }, { scope: 'polling' });
      const results = await Promise.allSettled(pollTasks.map((task) => task.run()));

      // Warm AFTER the polls: pollSonarr/Radarr/Lidarr invalidate the library
      // cache when they observe an import, and a warm fetch racing them could
      // write a pre-import snapshot back over that invalidation for the TTL.
      await this.runPollSource('warmCaches', () => this.warmCaches()).catch((e) => {
        logger.error('Cache warming failed', e, { scope: 'polling' });
      });

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

    let queue: Array<{ instanceId: string; series: SonarrSeries }>;
    try {
      const settings = await getOrCreateAppSettings();
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
  private async warmCaches(): Promise<void> {
    // allSettled + per-scope logging: one failing scope must not abort or mask
    // the other warmups.
    const warms = [
      { scope: 'sonarr', run: () => getCachedTaggedLibrary({ scope: 'sonarr', cacheKeySeed: 'all', getInstances: getSonarrClients, fetchOne: (c) => c.getSeries() }) },
      { scope: 'radarr', run: () => getCachedTaggedLibrary({ scope: 'radarr', cacheKeySeed: 'all', getInstances: getRadarrClients, fetchOne: (c) => c.getMovies() }) },
      { scope: 'lidarr', run: () => getCachedTaggedLibrary({ scope: 'lidarr', cacheKeySeed: 'all', getInstances: getLidarrClients, fetchOne: (c) => c.getArtists() }) },
    ] as const;
    const results = await Promise.allSettled(warms.map((w) => w.run()));
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
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

  // Probes every configured service connection and fires a push when one
  // transitions up→down (serviceDown) or down→up (serviceRestored). State lives
  // in PollingState.lastReachable, mirroring the lastHealthHash transition
  // pattern. The first probe of a connection only records a baseline (no alert),
  // so a server restart while a service is down doesn't re-spam the down alert.
  private async pollServiceReachability(): Promise<void> {
    const connections = await prisma.serviceConnection.findMany();
    if (connections.length === 0) return;

    const states = await prisma.pollingState.findMany({
      where: { serviceConnectionId: { in: connections.map((c) => c.id) } },
      select: { serviceConnectionId: true, lastReachable: true },
    });
    const prevReachable = new Map(states.map((s) => [s.serviceConnectionId, s.lastReachable]));

    await Promise.all(
      connections.map(async (connection) => {
        try {
          const { ok, error } = await probeServiceHealth(connection);
          const prev = prevReachable.get(connection.id) ?? null;
          const serviceName = SERVICE_LABELS[connection.type] ?? connection.type;

          if (prev !== null && prev !== ok) {
            // Isolate notify failures: the lastReachable write below must always
            // run, or we'd re-detect the same transition and re-alert next cycle.
            try {
              if (!ok) {
                await this.notifyAndLog({
                  eventType: 'serviceDown',
                  title: `${serviceName} is unreachable`,
                  body: (error ? `${connection.label}: ${error}` : `${connection.label} is not responding`).slice(0, 200),
                  url: '/settings/status',
                  metadata: { source: 'service-health', id: connection.id, redirect: '/settings/status' },
                }, { service: 'reachability', instanceId: connection.id, reason: 'service-down' });
              } else {
                await this.notifyAndLog({
                  eventType: 'serviceRestored',
                  title: `${serviceName} is back online`,
                  body: `${connection.label} is responding again`,
                  url: '/settings/status',
                  metadata: { source: 'service-health', id: connection.id, redirect: '/settings/status' },
                }, { service: 'reachability', instanceId: connection.id, reason: 'service-restored' });
              }
            } catch (notifyError) {
              logger.warn('Service reachability notify failed', {
                instanceId: connection.id,
                error: errorMessage(notifyError),
              }, { scope: 'polling' });
            }
          }

          // Deliberately no lastQueueIds here: the queue baseline (and the
          // first-run detection built on it) belongs to the queue pollers.
          await prisma.pollingState.upsert({
            where: { serviceConnectionId: connection.id },
            update: { lastReachable: ok },
            create: { serviceConnectionId: connection.id, lastReachable: ok },
          }).catch(() => {});
        } catch (error) {
          logger.debug('Reachability probe failed unexpectedly', {
            instanceId: connection.id,
            error: errorMessage(error),
          }, { scope: 'polling' });
        }
      })
    );
  }

  // Per-disk low-space alerts. Thresholds are global/admin config
  // (AppSettings.diskThresholds); the below/above edge + last-reminder time per
  // disk live in AppSettings.diskAlertState (aggregated, cross-connection — so
  // PollingState, which is keyed per connection, is the wrong store). notifyEvent
  // does NOT suppress repeats, so this state is what prevents a push every cycle.
  private async checkDiskSpace(): Promise<void> {
    const settings = await getOrCreateAppSettings();
    const thresholds = parseDiskThresholds(settings.diskThresholds).filter((t) => t.enabled);
    if (thresholds.length === 0) return; // feature unused → zero cost

    let disks;
    try {
      disks = await getAggregatedDiskSpace();
    } catch (error) {
      logger.debug('Disk-space check skipped: could not read disk space', {
        error: errorMessage(error),
      }, { scope: 'polling' });
      return;
    }
    if (disks.length === 0) return;

    const diskById = new Map(disks.map((d) => [diskId(d), d]));
    const prevState = parseDiskAlertState(settings.diskAlertState);
    const nextState: DiskAlertState = {};
    const nowMs = Date.now();
    const nowIso = new Date().toISOString();

    for (const threshold of thresholds) {
      const disk = diskById.get(threshold.diskId);
      if (!disk) continue; // thresholded disk not present this cycle — prune its state

      const freeGb = disk.freeSpace / 1024 ** 3;
      const belowNow = freeGb < threshold.minFreeGb;
      const prev = prevState[threshold.diskId] ?? { below: false, lastAlertAt: null };

      if (!belowNow) {
        // Recovered (or never below): reset so the next drop alerts immediately.
        nextState[threshold.diskId] = { below: false, lastAlertAt: null };
        continue;
      }

      const lastMs = prev.lastAlertAt ? Date.parse(prev.lastAlertAt) : NaN;
      const cooldownElapsed = !Number.isFinite(lastMs) || nowMs - lastMs >= DISK_ALERT_REMINDER_MS;
      const shouldFire = !prev.below || cooldownElapsed;

      if (shouldFire) {
        const totalGb = disk.totalSpace / 1024 ** 3;
        const pct = disk.totalSpace > 0 ? Math.round((disk.freeSpace / disk.totalSpace) * 100) : 0;
        const name = disk.label || disk.path;
        await this.notifyAndLog({
          eventType: 'diskLowSpace',
          title: `Low disk space: ${name}`,
          body: `${freeGb.toFixed(0)} GB free of ${totalGb.toFixed(0)} GB (${pct}%)`,
          url: '/settings/storage',
          metadata: {
            id: threshold.diskId,
            path: disk.path,
            label: disk.label,
            freeSpace: disk.freeSpace,
            totalSpace: disk.totalSpace,
            redirect: '/settings/storage',
          },
        }, { service: 'disk', reason: 'low-space', diskId: threshold.diskId });
        nextState[threshold.diskId] = { below: true, lastAlertAt: nowIso };
      } else {
        // Still below but within the reminder window — hold the existing timer.
        nextState[threshold.diskId] = { below: true, lastAlertAt: prev.lastAlertAt };
      }
    }

    // Only write when something actually changed (an alert fired, a recovery, or
    // a stale key got pruned) — avoid a DB write every cycle when nothing moved.
    if (!diskAlertStateEqual(prevState, nextState)) {
      await prisma.appSettings.update({
        where: { id: 'singleton' },
        data: { diskAlertState: nextState as unknown as Prisma.InputJsonValue },
      });
    }
  }

  private async shouldSnapshotDiskUsage(): Promise<boolean> {
    const settings = await getOrCreateAppSettings();
    const capturedDate = localDateOnly(new Date(), settings.timeZone);
    const existing = await prisma.diskUsageSnapshot.findFirst({
      where: { capturedDate },
      select: { id: true },
    });
    return existing === null;
  }

  // Daily disk-usage history powering the storage widget's trend + days-until-full.
  // The poll cycle gates this before external disk API calls once today's snapshot exists.
  // Independent of checkDiskSpace (which early-returns when no thresholds are set).
  private async snapshotDiskUsage(): Promise<void> {
    const now = new Date();
    let disks;
    try {
      disks = await getAggregatedDiskSpace();
    } catch (error) {
      logger.debug('Disk-usage snapshot skipped: could not read disk space', {
        error: errorMessage(error),
      }, { scope: 'polling' });
      return;
    }
    if (disks.length === 0) return;

    const settings = await getOrCreateAppSettings();
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

      const cutoff = new Date(Date.now() - DISK_SNAPSHOT_RETENTION_MS);
      await prisma.diskUsageSnapshot.deleteMany({ where: { capturedAt: { lt: cutoff } } });
    }
  }

  private async pollSonarr() {
    let instances;
    try {
      instances = await getSonarrClients();
    } catch (error) {
      logger.debug('Skipping Sonarr poll because clients are unavailable', { error }, { scope: 'polling' });
      return;
    }
    if (instances.length === 0) return;

    const n = instances.length;
    const groupingEnabled = (await getOrCreateAppSettings()).notificationGroupingEnabled;
    let badgeTotal = 0;
    let badgeAttention = 0;

    for (const { connection, client } of instances) {
      const instanceId = connection.id;
      // Per-instance so a failed instance can't bleed its buffered events into
      // the next instance's flush (and re-fire next cycle as duplicates).
      const collector = new PollNotificationCollector();
      const instanceLabel = connection.label;
      try {
        const { state, firstRun } = await getPollingState(instanceId);

        // Queue polling
        const tagMap = await buildTagMap(client);
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
            instanceId,
            instanceLabel,
            id: item.id,
            seriesId: item.seriesId,
            seasonNumber: item.seasonNumber ?? item.episode?.seasonNumber,
            episodeId: item.episodeId ?? item.episode?.id,
            ...mediaFilterMeta(item, tagMap),
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
            if (firstRun) continue; // baseline: pre-existing item, not new
            if (currentIssue === 'import') {
              importIssueCount++;
              const redirect = failedTabHref;
              collector.add({
                eventType: 'importFailed',
                title: this.instanceTitle('Manual Import Required', instanceLabel, n),
                body: importFailureBody(item),
                metadata: { ...metadata, redirect, state: item.trackedDownloadState },
                url: redirect,
              }, { service: 'sonarr', instanceId, reason: 'queue-import-blocked-new', itemId: item.id });
            } else if (currentIssue === 'download') {
              downloadFailedCount++;
              const redirect = queueHref;
              collector.add({
                eventType: 'downloadFailed',
                title: this.instanceTitle('Download Failed', instanceLabel, n),
                body: downloadFailureBody(item),
                metadata: { ...metadata, redirect, state: item.trackedDownloadState },
                url: redirect,
              }, { service: 'sonarr', instanceId, reason: 'queue-download-failed-new', itemId: item.id });
            } else {
              const redirect = mediaHref ?? queueHref;
              collector.add({
                eventType: 'grabbed',
                title: this.instanceTitle('Download Started', instanceLabel, n),
                body: item.title,
                metadata: { ...metadata, redirect },
                url: redirect,
              }, { service: 'sonarr', instanceId, reason: 'queue-new-item', itemId: item.id });
            }
          } else if (prev !== 'legacy' && currentIssue !== prevIssue) {
            // Transition into a problematic state — fire the matching notification.
            // Transitions back to normal are silent (success is announced by the
            // history "imported" event).
            if (currentIssue === 'import') {
              importIssueCount++;
              const redirect = failedTabHref;
              collector.add({
                eventType: 'importFailed',
                title: this.instanceTitle('Manual Import Required', instanceLabel, n),
                body: importFailureBody(item),
                metadata: { ...metadata, redirect, state: item.trackedDownloadState },
                url: redirect,
              }, { service: 'sonarr', instanceId, reason: 'queue-import-blocked-transition', itemId: item.id });
            } else if (currentIssue === 'download') {
              downloadFailedCount++;
              const redirect = queueHref;
              collector.add({
                eventType: 'downloadFailed',
                title: this.instanceTitle('Download Failed', instanceLabel, n),
                body: downloadFailureBody(item),
                metadata: { ...metadata, redirect, state: item.trackedDownloadState },
                url: redirect,
              }, { service: 'sonarr', instanceId, reason: 'queue-download-failed-transition', itemId: item.id });
            }
          }
        }

        logger.debug('Sonarr queue polled', {
          instanceId,
          queueCount: queue.records.length,
          previousQueueCount: prevMap.size,
          newQueueCount,
          importIssueCount,
          downloadFailedCount,
        }, { scope: 'polling' });

        // Nav badge: summed across instances; written once after the loop.
        badgeTotal += queue.totalRecords;
        badgeAttention += queue.records.filter(
          (r) => classifyQueueIssue(r.trackedDownloadState, r.trackedDownloadStatus) !== null,
        ).length;

        // History polling
        const historyCursorState = historyCursorFromState(state);
        const { allFetched: historyRecords, newRecords: newHistory } = await fetchNewHistoryPages(client, historyCursorState);
        logger.debug('Sonarr history polled', {
          instanceId,
          historyCount: historyRecords.length,
          lastHistoryDate: state.lastHistoryDate,
          newHistoryCount: newHistory.length,
        }, { scope: 'polling' });

        for (const item of newHistory) {
          if (item.eventType === 'downloadFolderImported' || item.eventType === 'episodeFileImported') {
            const metadata = {
              source: 'sonarr' as const,
              instanceId,
              instanceLabel,
              id: item.id,
              seriesId: item.seriesId,
              seasonNumber: item.episode?.seasonNumber,
              episodeId: item.episodeId ?? item.episode?.id,
              ...mediaFilterMeta(item, tagMap),
            };
            const redirect = getMediaHrefFromIds(metadata) ?? '/activity/history';

            collector.add({
              eventType: 'imported',
              title: this.instanceTitle('Episode Imported', instanceLabel, n),
              body: `${item.sourceTitle}`,
              metadata: { ...metadata, redirect },
              url: redirect,
            }, { service: 'sonarr', instanceId, reason: 'history-imported', historyId: item.id });
          }
        }

        // A new import means the library changed: bust the cached library here
        // so freshness doesn't depend on a browser polling the command status
        // to completion. warmCaches re-populates fresh data next cycle.
        if (newHistory.some((item) => item.eventType === 'downloadFolderImported' || item.eventType === 'episodeFileImported')) {
          await invalidateTaggedLibrary('sonarr', instanceId);
        }

        // Health check
        const health = await client.getHealth();
        const healthHash = crypto.createHash('md5').update(JSON.stringify(health)).digest('hex');
        logger.debug('Sonarr health polled', {
          instanceId,
          healthCount: health.length,
          changed: Boolean(state.lastHealthHash && healthHash !== state.lastHealthHash),
        }, { scope: 'polling' });
        if (state.lastHealthHash && healthHash !== state.lastHealthHash && health.length > 0) {
          await this.notifyAndLog({
            eventType: 'healthWarning',
            title: this.instanceTitle('Sonarr Health Warning', instanceLabel, n),
            body: health.map((h) => h.message).join('; ').slice(0, 200),
            url: '/settings',
          }, { service: 'sonarr', instanceId, reason: 'health-changed', healthCount: health.length });
        }

        // Collapse same-type bursts (e.g. a season pack) into one grouped
        // notification per (instance, eventType); below-threshold groups and
        // singletons send individually. No-op shape when grouping is disabled.
        await collector.flush({ enabled: groupingEnabled, notify: this.notifyAndLog.bind(this) });

        // Update state
        const cursor = advanceHistoryCursor(newHistory, historyRecords, historyCursorState);
        await prisma.pollingState.update({
          where: { serviceConnectionId: instanceId },
          data: {
            lastQueueIds: currentSnapshots as unknown as object,
            lastHistoryDate: cursor.lastHistoryDate,
            lastHistoryId: cursor.lastHistoryId,
            lastHistorySeenIds: cursor.lastHistorySeenIds,
            lastHealthHash: healthHash,
          },
        });
        logger.debug('Sonarr polling state updated', {
          instanceId,
          queueCount: currentSnapshots.length,
          lastHistoryDate: cursor.lastHistoryDate,
          healthHash,
        }, { scope: 'polling' });
      } catch (error) {
        logger.warn('Sonarr instance poll failed', { instanceId, error: errorMessage(error) }, { scope: 'polling' });
      }
    }

    await writeBadgeSlice('activity', 'sonarr', { total: badgeTotal, attention: badgeAttention });
  }

  private async pollRadarr() {
    let instances;
    try {
      instances = await getRadarrClients();
    } catch (error) {
      logger.debug('Skipping Radarr poll because clients are unavailable', { error }, { scope: 'polling' });
      return;
    }
    if (instances.length === 0) return;

    const n = instances.length;
    const groupingEnabled = (await getOrCreateAppSettings()).notificationGroupingEnabled;
    let badgeTotal = 0;
    let badgeAttention = 0;

    for (const { connection, client } of instances) {
      const instanceId = connection.id;
      // Per-instance so a failed instance can't bleed its buffered events into
      // the next instance's flush (and re-fire next cycle as duplicates).
      const collector = new PollNotificationCollector();
      const instanceLabel = connection.label;
      try {
        const { state, firstRun } = await getPollingState(instanceId);

        const tagMap = await buildTagMap(client);
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
            instanceId,
            instanceLabel,
            id: item.id,
            movieId: item.movieId,
            ...mediaFilterMeta(item, tagMap),
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
            if (firstRun) continue; // baseline: pre-existing item, not new
            if (currentIssue === 'import') {
              importIssueCount++;
              const redirect = failedTabHref;
              collector.add({
                eventType: 'importFailed',
                title: this.instanceTitle('Movie Manual Import Required', instanceLabel, n),
                body: importFailureBody(item),
                metadata: { ...metadata, redirect, state: item.trackedDownloadState },
                url: redirect,
              }, { service: 'radarr', instanceId, reason: 'queue-import-blocked-new', itemId: item.id });
            } else if (currentIssue === 'download') {
              downloadFailedCount++;
              const redirect = queueHref;
              collector.add({
                eventType: 'downloadFailed',
                title: this.instanceTitle('Movie Download Failed', instanceLabel, n),
                body: downloadFailureBody(item),
                metadata: { ...metadata, redirect, state: item.trackedDownloadState },
                url: redirect,
              }, { service: 'radarr', instanceId, reason: 'queue-download-failed-new', itemId: item.id });
            } else {
              const redirect = mediaHref ?? queueHref;
              collector.add({
                eventType: 'grabbed',
                title: this.instanceTitle('Movie Download Started', instanceLabel, n),
                body: item.title,
                metadata: { ...metadata, redirect },
                url: redirect,
              }, { service: 'radarr', instanceId, reason: 'queue-new-item', itemId: item.id });
            }
          } else if (prev !== 'legacy' && currentIssue !== prevIssue) {
            if (currentIssue === 'import') {
              importIssueCount++;
              const redirect = failedTabHref;
              collector.add({
                eventType: 'importFailed',
                title: this.instanceTitle('Movie Manual Import Required', instanceLabel, n),
                body: importFailureBody(item),
                metadata: { ...metadata, redirect, state: item.trackedDownloadState },
                url: redirect,
              }, { service: 'radarr', instanceId, reason: 'queue-import-blocked-transition', itemId: item.id });
            } else if (currentIssue === 'download') {
              downloadFailedCount++;
              const redirect = queueHref;
              collector.add({
                eventType: 'downloadFailed',
                title: this.instanceTitle('Movie Download Failed', instanceLabel, n),
                body: downloadFailureBody(item),
                metadata: { ...metadata, redirect, state: item.trackedDownloadState },
                url: redirect,
              }, { service: 'radarr', instanceId, reason: 'queue-download-failed-transition', itemId: item.id });
            }
          }
        }

        logger.debug('Radarr queue polled', {
          instanceId,
          queueCount: queue.records.length,
          previousQueueCount: prevMap.size,
          newQueueCount,
          importIssueCount,
          downloadFailedCount,
        }, { scope: 'polling' });

        // Nav badge: summed across instances; written once after the loop.
        badgeTotal += queue.totalRecords;
        badgeAttention += queue.records.filter(
          (r) => classifyQueueIssue(r.trackedDownloadState, r.trackedDownloadStatus) !== null,
        ).length;

        const historyCursorState = historyCursorFromState(state);
        const { allFetched: historyRecords, newRecords: newHistory } = await fetchNewHistoryPages(client, historyCursorState);
        logger.debug('Radarr history polled', {
          instanceId,
          historyCount: historyRecords.length,
          lastHistoryDate: state.lastHistoryDate,
          newHistoryCount: newHistory.length,
        }, { scope: 'polling' });

        for (const item of newHistory) {
          if (item.eventType === 'downloadFolderImported' || item.eventType === 'movieFileImported') {
            const metadata = {
              source: 'radarr' as const,
              instanceId,
              instanceLabel,
              id: item.id,
              movieId: item.movieId,
              ...mediaFilterMeta(item, tagMap),
            };
            const redirect = getMediaHrefFromIds(metadata) ?? '/activity/history';

            collector.add({
              eventType: 'imported',
              title: this.instanceTitle('Movie Imported', instanceLabel, n),
              body: `${item.sourceTitle}`,
              metadata: { ...metadata, redirect },
              url: redirect,
            }, { service: 'radarr', instanceId, reason: 'history-imported', historyId: item.id });
          }
        }

        // A new import means the library changed: bust the cached library here
        // so freshness doesn't depend on a browser polling the command status
        // to completion. warmCaches re-populates fresh data next cycle.
        if (newHistory.some((item) => item.eventType === 'downloadFolderImported' || item.eventType === 'movieFileImported')) {
          await invalidateTaggedLibrary('radarr', instanceId);
        }

        const health = await client.getHealth();
        const healthHash = crypto.createHash('md5').update(JSON.stringify(health)).digest('hex');
        logger.debug('Radarr health polled', {
          instanceId,
          healthCount: health.length,
          changed: Boolean(state.lastHealthHash && healthHash !== state.lastHealthHash),
        }, { scope: 'polling' });
        if (state.lastHealthHash && healthHash !== state.lastHealthHash && health.length > 0) {
          await this.notifyAndLog({
            eventType: 'healthWarning',
            title: this.instanceTitle('Radarr Health Warning', instanceLabel, n),
            body: health.map((h) => h.message).join('; ').slice(0, 200),
            url: '/settings',
          }, { service: 'radarr', instanceId, reason: 'health-changed', healthCount: health.length });
        }

        await collector.flush({ enabled: groupingEnabled, notify: this.notifyAndLog.bind(this) });

        const cursor = advanceHistoryCursor(newHistory, historyRecords, historyCursorState);
        await prisma.pollingState.update({
          where: { serviceConnectionId: instanceId },
          data: {
            lastQueueIds: currentSnapshots as unknown as object,
            lastHistoryDate: cursor.lastHistoryDate,
            lastHistoryId: cursor.lastHistoryId,
            lastHistorySeenIds: cursor.lastHistorySeenIds,
            lastHealthHash: healthHash,
          },
        });
        logger.debug('Radarr polling state updated', {
          instanceId,
          queueCount: currentSnapshots.length,
          lastHistoryDate: cursor.lastHistoryDate,
          healthHash,
        }, { scope: 'polling' });
      } catch (error) {
        logger.warn('Radarr instance poll failed', { instanceId, error: errorMessage(error) }, { scope: 'polling' });
      }
    }

    await writeBadgeSlice('activity', 'radarr', { total: badgeTotal, attention: badgeAttention });
  }

  private async pollLidarr() {
    let instances;
    try {
      instances = await getLidarrClients();
    } catch (error) {
      logger.debug('Skipping Lidarr poll because clients are unavailable', { error }, { scope: 'polling' });
      return;
    }
    if (instances.length === 0) return;

    const n = instances.length;
    const groupingEnabled = (await getOrCreateAppSettings()).notificationGroupingEnabled;
    let badgeTotal = 0;
    let badgeAttention = 0;

    for (const { connection, client } of instances) {
      const instanceId = connection.id;
      // Per-instance so a failed instance can't bleed its buffered events into
      // the next instance's flush (and re-fire next cycle as duplicates).
      const collector = new PollNotificationCollector();
      const instanceLabel = connection.label;
      try {
        const { state, firstRun } = await getPollingState(instanceId);

        const tagMap = await buildTagMap(client);
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
            instanceId,
            instanceLabel,
            id: item.id,
            artistId: item.artistId,
            albumId: item.albumId,
            ...mediaFilterMeta(item, tagMap),
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
            if (firstRun) continue; // baseline: pre-existing item, not new
            if (currentIssue === 'import') {
              collector.add({
                eventType: 'importFailed',
                title: this.instanceTitle('Album Manual Import Required', instanceLabel, n),
                body: importFailureBody(item),
                metadata: { ...metadata, redirect: failedTabHref, state: item.trackedDownloadState },
                url: failedTabHref,
              }, { service: 'lidarr', instanceId, reason: 'queue-import-blocked-new', itemId: item.id });
            } else if (currentIssue === 'download') {
              collector.add({
                eventType: 'downloadFailed',
                title: this.instanceTitle('Album Download Failed', instanceLabel, n),
                body: downloadFailureBody(item),
                metadata: { ...metadata, redirect: queueHref, state: item.trackedDownloadState },
                url: queueHref,
              }, { service: 'lidarr', instanceId, reason: 'queue-download-failed-new', itemId: item.id });
            } else {
              const redirect = mediaHref ?? queueHref;
              collector.add({
                eventType: 'grabbed',
                title: this.instanceTitle('Album Download Started', instanceLabel, n),
                body: item.title,
                metadata: { ...metadata, redirect },
                url: redirect,
              }, { service: 'lidarr', instanceId, reason: 'queue-new-item', itemId: item.id });
            }
          } else if (prev !== 'legacy' && currentIssue !== prevIssue) {
            if (currentIssue === 'import') {
              collector.add({
                eventType: 'importFailed',
                title: this.instanceTitle('Album Manual Import Required', instanceLabel, n),
                body: importFailureBody(item),
                metadata: { ...metadata, redirect: failedTabHref, state: item.trackedDownloadState },
                url: failedTabHref,
              }, { service: 'lidarr', instanceId, reason: 'queue-import-blocked-transition', itemId: item.id });
            } else if (currentIssue === 'download') {
              collector.add({
                eventType: 'downloadFailed',
                title: this.instanceTitle('Album Download Failed', instanceLabel, n),
                body: downloadFailureBody(item),
                metadata: { ...metadata, redirect: queueHref, state: item.trackedDownloadState },
                url: queueHref,
              }, { service: 'lidarr', instanceId, reason: 'queue-download-failed-transition', itemId: item.id });
            }
          }
        }

        // Nav badge: summed across instances; written once after the loop.
        badgeTotal += queue.totalRecords;
        badgeAttention += queue.records.filter(
          (r) => classifyQueueIssue(r.trackedDownloadState, r.trackedDownloadStatus) !== null,
        ).length;

        const historyCursorState = historyCursorFromState(state);
        const { allFetched: historyRecords, newRecords: newHistory } = await fetchNewHistoryPages(client, historyCursorState);

        for (const item of newHistory) {
          if (item.eventType === 'downloadImported' || item.eventType === 'trackFileImported') {
            const metadata = {
              source: 'lidarr' as const,
              instanceId,
              instanceLabel,
              id: item.id,
              artistId: item.artistId,
              albumId: item.albumId,
              ...mediaFilterMeta(item, tagMap),
            };
            const redirect = getMediaHrefFromIds(metadata) ?? '/activity/history';
            collector.add({
              eventType: 'imported',
              title: this.instanceTitle('Album Imported', instanceLabel, n),
              body: `${item.sourceTitle}`,
              metadata: { ...metadata, redirect },
              url: redirect,
            }, { service: 'lidarr', instanceId, reason: 'history-imported', historyId: item.id });
          }
        }

        // A new import means the library changed: bust the cached library here
        // so freshness doesn't depend on a browser polling the command status
        // to completion. warmCaches re-populates fresh data next cycle.
        if (newHistory.some((item) => item.eventType === 'downloadImported' || item.eventType === 'trackFileImported')) {
          await invalidateTaggedLibrary('lidarr', instanceId);
        }

        const health = await client.getHealth();
        const healthHash = crypto.createHash('md5').update(JSON.stringify(health)).digest('hex');
        if (state.lastHealthHash && healthHash !== state.lastHealthHash && health.length > 0) {
          await this.notifyAndLog({
            eventType: 'healthWarning',
            title: this.instanceTitle('Lidarr Health Warning', instanceLabel, n),
            body: health.map((h) => h.message).join('; ').slice(0, 200),
            url: '/settings',
          }, { service: 'lidarr', instanceId, reason: 'health-changed', healthCount: health.length });
        }

        await collector.flush({ enabled: groupingEnabled, notify: this.notifyAndLog.bind(this) });

        const cursor = advanceHistoryCursor(newHistory, historyRecords, historyCursorState);
        await prisma.pollingState.update({
          where: { serviceConnectionId: instanceId },
          data: {
            lastQueueIds: currentSnapshots as unknown as object,
            lastHistoryDate: cursor.lastHistoryDate,
            lastHistoryId: cursor.lastHistoryId,
            lastHistorySeenIds: cursor.lastHistorySeenIds,
            lastHealthHash: healthHash,
          },
        });
        logger.debug('Lidarr polling state updated', {
          instanceId,
          queueCount: currentSnapshots.length,
        }, { scope: 'polling' });
      } catch (error) {
        logger.warn('Lidarr instance poll failed', { instanceId, error: errorMessage(error) }, { scope: 'polling' });
      }
    }

    await writeBadgeSlice('activity', 'lidarr', { total: badgeTotal, attention: badgeAttention });
  }

  private async pollQBittorrent() {
    let client;
    try {
      client = await getQBittorrentClient();
    } catch (error) {
      logger.debug('Skipping qBittorrent poll because client is unavailable', { error }, { scope: 'polling' });
      return;
    }

    const connection = await getDefaultConnection('QBITTORRENT');
    if (!connection) return;

    const { state, firstRun } = await getPollingState(connection.id);

    const groupingEnabled = (await getOrCreateAppSettings()).notificationGroupingEnabled;
    const collector = new PollNotificationCollector();

    const torrents = await client.getTorrents();
    const currentMap = new Map(torrents.map((t) => [t.hash, t]));

    // Arr-managed handoffs are reconciled from Arr queue/history and exact file
    // deltas, so a Helprr restart cannot lose an accepted grab or its import.
    await reconcileManualDownloads();

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
      if (!prev && !firstRun) {
        collector.add({
          eventType: 'torrentAdded',
          title: 'Torrent Added',
          body: torrent.name,
          metadata: { source: 'qbittorrent', hash: torrent.hash, redirect: '/torrents' },
          url: '/torrents',
        }, { service: 'qbittorrent', reason: 'torrent-added', hash: torrent.hash });
      }

      // Detect completed (progress went from <1 to 1)
      if (torrent.progress >= 1 && prev && prev.progress < 1) {
        collector.add({
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
        collector.add({
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

    await collector.flush({ enabled: groupingEnabled, notify: this.notifyAndLog.bind(this) });

    // Update state
    await prisma.pollingState.update({
      where: { serviceConnectionId: connection.id },
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

    const connection = await getDefaultConnection('JELLYFIN');
    if (!connection) return;

    const state = await prisma.pollingState.upsert({
      where: { serviceConnectionId: connection.id },
      update: {},
      create: { serviceConnectionId: connection.id, lastQueueIds: [] },
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

      const startedSessions = newSessions.filter((s) => s.NowPlayingItem);

      // Map the streaming Jellyfin users to Helprr accounts (batched, once per
      // cycle) so playback pushes are user-aware: the history row is stamped to
      // the streamer and they are not pushed about their own stream. Sessions
      // from unlinked Jellyfin users keep today's broadcast behavior.
      let ownerByJellyfinId = new Map<string, string>();
      let activeUserIds: string[] = [];
      if (startedSessions.length) {
        const jellyfinIds = Array.from(
          new Set(
            startedSessions
              .map((s) => s.UserId)
              .filter((id): id is string => !!id)
          )
        );
        if (jellyfinIds.length) {
          ownerByJellyfinId = new Map(
            (
              await prisma.user.findMany({
                where: { jellyfinUserId: { in: jellyfinIds } },
                select: { id: true, jellyfinUserId: true },
              })
            ).map((u) => [u.jellyfinUserId as string, u.id])
          );
        }
        if (ownerByJellyfinId.size) {
          activeUserIds = (
            await prisma.user.findMany({
              where: { status: 'active' },
              select: { id: true },
            })
          ).map((u) => u.id);
        }
      }

      for (const session of startedSessions) {
        const item = session.NowPlayingItem;
        if (item) {
          const title = item.SeriesName
            ? `${item.SeriesName} - ${item.Name}`
            : item.Name;
          const ownerId = session.UserId
            ? ownerByJellyfinId.get(session.UserId) ?? null
            : null;
          await this.notifyAndLog({
            eventType: 'jellyfinPlaybackStart',
            title: 'Playback Started',
            body: `${session.UserName} is watching ${title}`,
            metadata: {
              source: 'jellyfin',
              sessionId: session.Id,
              // Matched against each device's muted-users filter at delivery.
              jellyfinUserId: session.UserId,
              jellyfinUserName: session.UserName,
              redirect: '/jellyfin',
            },
            url: '/jellyfin',
            // Everyone but the streamer; an empty list (sole-user instance)
            // still suppresses the self-push while the history row is kept.
            userIds: ownerId ? activeUserIds.filter((id) => id !== ownerId) : undefined,
            ownerUserId: ownerId,
          }, { service: 'jellyfin', reason: 'playback-start', sessionId: session.Id });
        }
      }

      await prisma.pollingState.update({
        where: { serviceConnectionId: connection.id },
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

    const connection = await getDefaultConnection('SEERR');
    if (!connection) return;

    const state = await prisma.pollingState.upsert({
      where: { serviceConnectionId: connection.id },
      update: {},
      create: { serviceConnectionId: connection.id, lastQueueIds: [] },
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
      where: { serviceConnectionId: connection.id },
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
    //
    // Prefetch every recent upcomingPremiere row ONCE instead of a findFirst per
    // calendar item per instance (the old N+1, run every poll cycle). A matching
    // row was written when its item was last inside the notify window — at most
    // (notifyBefore + grace) before its air time, and the furthest air time we
    // consider is fetchEndMs — so look back that far plus a day of slack; older
    // rows can't match a key we build this cycle. The snapshot doesn't see rows
    // written later in this same cycle, so we also record each key as we fire it
    // (notifiedKeys.add below) — that suppresses a duplicate calendar entry that
    // a malformed/proxied upstream might repeat within one response.
    const dedupeLookbackMs =
      (settings.upcomingNotifyBeforeMins + BEFORE_AIR_GRACE_MIN) * 60_000 +
      FETCH_END_BUFFER_MS +
      86_400_000;
    const priorUpcoming = await prisma.notificationHistory.findMany({
      where: {
        eventType: 'upcomingPremiere',
        createdAt: { gte: new Date(now.getTime() - dedupeLookbackMs) },
      },
      select: { dedupeKey: true, body: true, metadata: true },
    });
    const notifiedKeys = new Set<string>();
    const notifiedBodies = new Set<string>();
    for (const row of priorUpcoming) {
      if (row.dedupeKey) {
        notifiedKeys.add(row.dedupeKey);
        continue;
      }
      // A grouped row has no top-level dedupeKey; its per-item keys live in
      // metadata.itemDedupeKeys (see notification-grouping.ts). Harvest them so
      // items sent inside a digest are still suppressed on later cycles.
      const md = row.metadata as { grouped?: unknown; itemDedupeKeys?: unknown } | null;
      if (md?.grouped && Array.isArray(md.itemDedupeKeys)) {
        for (const key of md.itemDedupeKeys) {
          if (typeof key === 'string') notifiedKeys.add(key);
        }
      } else {
        notifiedBodies.add(row.body);
      }
    }
    const alreadyNotified = (dedupeKeys: string[], body: string): boolean =>
      dedupeKeys.some((key) => notifiedKeys.has(key)) || notifiedBodies.has(body);

    // Collapse same-cycle premiere bursts (e.g. the daily-digest hour firing
    // every premiere of the day at once) into one grouped push per
    // (source, instance). Flushed after all three calendar sections; a failed
    // flush just re-fires next cycle because no history row was written.
    const collector = new PollNotificationCollector();

    const shouldFireBeforeAir = (airTimeMs: number): boolean => {
      const minsUntilAir = (airTimeMs - now.getTime()) / 60_000;
      return (
        minsUntilAir <= settings.upcomingNotifyBeforeMins &&
        minsUntilAir >= -BEFORE_AIR_GRACE_MIN
      );
    };

    // Sonarr calendar (every instance) ---------------------------------------
    // Client discovery is isolated per source (here and below) so one failure
    // can't abort the method before the collector flush and silently delay the
    // other sources' already-buffered notifications.
    let sonarrClients: Awaited<ReturnType<typeof getSonarrClients>> = [];
    try {
      sonarrClients = await getSonarrClients();
    } catch (error) {
      logger.warn('Skipping Sonarr upcoming poll because clients are unavailable', { error }, { scope: 'polling' });
    }
    for (const { connection, client } of sonarrClients) {
    try {
      const calendar = await client.getCalendar(start, end);
      logger.debug('Sonarr upcoming calendar polled', {
        instanceId: connection.id,
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
        const dedupeKey = `sonarr-${connection.id}-ep-${ep.id}-${airTimeMs}`;
        const legacyKey = `sonarr-ep-${ep.id}-${airTimeMs}`;

        if (alreadyNotified(connection.isDefault ? [dedupeKey, legacyKey] : [dedupeKey], body)) {
          logger.debug('Skipping duplicate Sonarr upcoming notification', {
            seriesId: ep.seriesId,
            episodeId: ep.id,
            dedupeKey,
          }, { scope: 'polling' });
          continue;
        }

        notifiedKeys.add(dedupeKey);
        collector.add({
          eventType: 'upcomingPremiere',
          title: this.instanceTitle(notificationTitle, connection.label, sonarrClients.length),
          body,
          dedupeKey,
          metadata: {
            source: 'sonarr',
            instanceId: connection.id,
            instanceLabel: connection.label,
            seriesId: ep.seriesId,
            seasonNumber: ep.seasonNumber,
            episodeId: ep.id,
            ...(ep.finaleType ? { finaleType: ep.finaleType } : {}),
            redirect: `/series/${ep.seriesId}/season/${ep.seasonNumber}/episode/${ep.id}?instance=${connection.id}`,
          },
          url: `/series/${ep.seriesId}?instance=${connection.id}`,
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
    }

    // Radarr calendar (every instance) ---------------------------------------
    let radarrClients: Awaited<ReturnType<typeof getRadarrClients>> = [];
    try {
      radarrClients = await getRadarrClients();
    } catch (error) {
      logger.warn('Skipping Radarr upcoming poll because clients are unavailable', { error }, { scope: 'polling' });
    }
    for (const { connection, client } of radarrClients) {
    try {
      const calendar = await client.getCalendar(start, end);
      logger.debug('Radarr upcoming calendar polled', {
        instanceId: connection.id,
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
          const dedupeKey = `radarr-${connection.id}-${movie.id}-${releaseType}-${releaseMs}`;
          const legacyKey = `radarr-${movie.id}-${releaseType}-${releaseMs}`;

          if (alreadyNotified(connection.isDefault ? [dedupeKey, legacyKey] : [dedupeKey], body)) {
            logger.debug('Skipping duplicate Radarr upcoming notification', {
              movieId: movie.id,
              releaseType,
              dedupeKey,
            }, { scope: 'polling' });
            continue;
          }

          notifiedKeys.add(dedupeKey);
          collector.add({
            eventType: 'upcomingPremiere',
            title: this.instanceTitle('Upcoming Movie', connection.label, radarrClients.length),
            body,
            dedupeKey,
            metadata: {
              source: 'radarr',
              instanceId: connection.id,
              instanceLabel: connection.label,
              movieId: movie.id,
              releaseType,
              redirect: `/movies/${movie.id}?instance=${connection.id}`,
            },
            url: `/movies/${movie.id}?instance=${connection.id}`,
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
    }

    // Lidarr calendar (every instance) ---------------------------------------
    let lidarrClients: Awaited<ReturnType<typeof getLidarrClients>> = [];
    try {
      lidarrClients = await getLidarrClients();
    } catch (error) {
      logger.warn('Skipping Lidarr upcoming poll because clients are unavailable', { error }, { scope: 'polling' });
    }
    for (const { connection, client } of lidarrClients) {
    try {
      const calendar = await client.getCalendar(start, end);
      logger.debug('Lidarr upcoming calendar polled', {
        instanceId: connection.id,
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
        const dedupeKey = `lidarr-${connection.id}-${album.id}-${releaseMs}`;
        const legacyKey = `lidarr-${album.id}-${releaseMs}`;
        if (alreadyNotified(connection.isDefault ? [dedupeKey, legacyKey] : [dedupeKey], body)) continue;

        notifiedKeys.add(dedupeKey);
        collector.add({
          eventType: 'upcomingPremiere',
          title: this.instanceTitle('Upcoming Album', connection.label, lidarrClients.length),
          body,
          dedupeKey,
          metadata: {
            source: 'lidarr',
            instanceId: connection.id,
            instanceLabel: connection.label,
            artistId: album.artistId,
            albumId: album.id,
            redirect: `/music/album/${album.id}?instance=${connection.id}`,
          },
          url: `/music/album/${album.id}?instance=${connection.id}`,
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

    await collector.flush({ enabled: settings.notificationGroupingEnabled, notify: this.notifyAndLog.bind(this) });
  }

  // Prune NotificationHistory rows past the configured retention window, plus
  // CleanupHistory and settled ScheduledAlertOccurrence rows past the fixed
  // AUDIT_HISTORY_RETENTION_MS window. The poll loop runs every ~30s, so
  // throttle the actual DELETEs to once/day. Indexed columns (createdAt /
  // [status, notifyAt]) keep the sweeps cheap even when nothing is due.
  private async checkNotificationRetention(): Promise<void> {
    const now = Date.now();
    if (now - this.lastNotificationPruneAt < 86_400_000) return;

    const settings = await getOrCreateAppSettings();
    const days = settings.notificationHistoryRetentionDays;
    const cutoff = new Date(now - days * 86_400_000);
    const { count } = await prisma.notificationHistory.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    const auditCutoff = new Date(now - AUDIT_HISTORY_RETENTION_MS);
    const { count: cleanupCount } = await prisma.cleanupHistory.deleteMany({
      where: { createdAt: { lt: auditCutoff } },
    });
    // Terminal statuses only — pending rows stay until delivery resolves them.
    // Safe against re-sends: upsertOccurrencesForAlert never re-creates a
    // candidate whose notifyAt is in the past.
    const { count: occurrenceCount } = await prisma.scheduledAlertOccurrence.deleteMany({
      where: { status: { in: ['sent', 'failed', 'cancelled'] }, notifyAt: { lt: auditCutoff } },
    });

    // Advance the throttle only after a successful sweep, so a transient DB
    // error retries on the next cycle instead of being skipped for a full day.
    this.lastNotificationPruneAt = now;
    if (count > 0 || cleanupCount > 0 || occurrenceCount > 0) {
      logger.info(
        'Pruned old history rows',
        {
          notifications: count,
          notificationRetentionDays: days,
          cleanupHistory: cleanupCount,
          alertOccurrences: occurrenceCount,
        },
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
