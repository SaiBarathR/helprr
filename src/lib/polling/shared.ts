// Helpers the pollers share: queue and history readers, the history cursor,
// media deep links, and sending a notification with its log line.
import { prisma } from '@/lib/db';
import { notifyEvent } from '@/lib/notification-service';
import { getOrCreateAppSettings } from '@/lib/app-settings';
import { logger } from '@/lib/logger';
import { noteJobFailure } from '@/lib/polling-job-report';
import type { PollingCycleContext } from '@/lib/polling-cycle';
import type { NotificationEventInput, PollNotificationContext } from '@/lib/notification-grouping';
import type { QueueItem, Tag } from '@/types';

export type AppSettingsSnapshot = Awaited<ReturnType<typeof getOrCreateAppSettings>>;
export type CycleContext = PollingCycleContext<AppSettingsSnapshot>;

export function firstStatusMessage(item: QueueItem): string | null {
  const messages = item.statusMessages;
  if (!messages || messages.length === 0) return null;
  for (const group of messages) {
    const first = group.messages?.find((m) => m && m.trim().length > 0);
    if (first) return first.trim();
  }
  return null;
}

export function importFailureBody(item: QueueItem): string {
  const reason = firstStatusMessage(item) ?? item.errorMessage?.trim() ?? '';
  return reason ? `${item.title} — ${reason}` : item.title;
}

export function downloadFailureBody(item: QueueItem): string {
  const reason = item.errorMessage?.trim() || firstStatusMessage(item) || '';
  return reason ? `${item.title} — ${reason}` : item.title;
}

// Per-instance, per-cycle tag-id → label map so queue/history notifications can
// carry the human tag labels their owning series/movie/artist holds. The tag
// list is small, so this is one cheap call per service instance. A failure
// yields an empty map (tags simply won't be available for filtering that cycle).
export async function buildTagMap(client: { getTags: () => Promise<Tag[]> }): Promise<Map<number, string>> {
  try {
    const tags = await client.getTags();
    return new Map(tags.map((t) => [t.id, t.label]));
  } catch (error) {
    noteJobFailure(error);
    return new Map();
  }
}

// Quality name + resolved tag labels for a queue/history item, attached to the
// notification metadata so NotificationPreference.tagFilter/qualityFilter can
// gate it in notifyEvent(). The nested series/movie/artist (which carry the
// numeric tag ids) are already included on queue/history records via the
// includeSeries/includeMovie request params.
export function mediaFilterMeta(
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

export type QueueSnapshot = { id: number; state: string; status: string };

export function readQueueSnapshots(raw: unknown): Map<number, QueueSnapshot | 'legacy'> {
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

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function toNumber(value: unknown): number | undefined {
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

export type HistoryCursorState = {
  lastHistoryDate: Date | null;
  lastHistoryId: number | null;
  lastHistorySeenIds: number[];
};

export function parseSeenIds(raw: unknown): number[] {
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
export async function getPollingState(serviceConnectionId: string) {
  const existing = await prisma.pollingState.findUnique({ where: { serviceConnectionId } });
  if (existing) return { state: existing, firstRun: existing.lastQueueIds === null };
  const state = await prisma.pollingState.create({ data: { serviceConnectionId } });
  return { state, firstRun: true };
}

export function historyCursorFromState(state: {
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

export function filterNewHistory<T extends { id: number; date: string }>(
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

export async function fetchNewHistoryPages<T extends { id: number; date: string }>(
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

export function advanceHistoryCursor(
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

export function getMediaHrefFromIds(args: {
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

export async function notifyAndLog(
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
    noteJobFailure(err);
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
export function instanceTitle(base: string, label: string, instanceCount: number): string {
  return instanceCount > 1 ? `${label} · ${base}` : base;
}
