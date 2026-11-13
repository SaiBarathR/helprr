import type { User } from '@prisma/client';
import type { Capability } from '@/lib/capabilities';
import { getQueueCached } from '@/lib/activity-queue';
import { getCachedJson, setCachedJson } from '@/lib/cache/json-cache';
import { fetchServiceCalendarEvents } from '@/lib/calendar-events';
import { ConfigurationError } from '@/lib/config-error';
import { prisma } from '@/lib/db';
import { can } from '@/lib/permissions';
import { dedupeDiskSpace } from '@/lib/disk-space';
import { historyScope } from '@/lib/notification-scope';
import { torrentCounters } from '@/lib/qbittorrent-summary';
import {
  getJellyfinClient,
  getLidarrClients,
  getQBittorrentClient,
  getRadarrClients,
  getSonarrClients,
} from '@/lib/service-helpers';
import type { QueueItem } from '@/types';
import type { DiskSpace } from '@/types/service-stats';

// The read-only status API behind personal API tokens (/api/v1/*). Shapes are
// a public contract (docs-site: status-api.md): add fields, never rename or
// remove one. A section the token may not read is left out; one it may read
// but whose service is not set up or did not answer is null.

export const STATUS_API_VERSION = 1;
const CACHE_SCOPE = 'status-api';
// Every section but alerts is the same for every viewer allowed it, so it is
// cached briefly, keyed by the scopes that decide which sections it holds.
const CACHE_TTL_SECONDS = 10;
const UPCOMING_DAYS = 60;
const UPCOMING_LIMIT = 3;
export const QUEUE_ITEM_LIMIT = 100;

export interface StatusSummary {
  version: number;
  generatedAt: string;
  downloads?: { downloading: number; downloadSpeed: number; uploadSpeed: number } | null;
  queue?: { total: number } | null;
  storage?: { freeBytes: number; totalBytes: number; disks: Array<{ path: string; label: string | null; freeBytes: number; totalBytes: number }> } | null;
  upcoming?: Array<{ type: 'episode' | 'movie' | 'album'; title: string; subtitle: string; date: string }> | null;
  streams?: { active: number } | null;
  alerts?: { unread: number } | null;
}

export interface StatusQueueItem {
  source: 'sonarr' | 'radarr' | 'lidarr' | null;
  instance: string | null;
  title: string;
  episode: string | null;
  status: string;
  progress: number;
  sizeBytes: number;
  sizeLeftBytes: number;
  timeLeft: string | null;
  estimatedCompletion: string | null;
}

export interface StatusQueue {
  version: number;
  generatedAt: string;
  total: number;
  /** An instance did not answer: its items and count are missing. */
  partial: boolean;
  items: StatusQueueItem[];
}

type SharedSections = Omit<StatusSummary, 'version' | 'generatedAt' | 'alerts'>;

/** Run one section's read: null when its service is not set up, null and `failed` when it did not answer. */
async function section<T>(read: () => Promise<T>, state: { failed: boolean }): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (!(error instanceof ConfigurationError)) state.failed = true;
    return null;
  }
}

async function readDownloads() {
  const client = await getQBittorrentClient();
  const [torrents, transfer] = await Promise.all([client.getTorrents(), client.getTransferInfo()]);
  return {
    downloading: torrentCounters(torrents).downloading,
    downloadSpeed: transfer.dl_info_speed,
    uploadSpeed: transfer.up_info_speed,
  };
}

async function readStorage(scopes: ReadonlySet<Capability>, state: { failed: boolean }) {
  // Each app's disks only with its own view scope, as on the dashboard.
  const sources: Array<() => Promise<Array<{ client: { getDiskSpace(): Promise<DiskSpace[]> } }>>> = [];
  if (scopes.has('movies.view')) sources.push(getRadarrClients);
  if (scopes.has('series.view')) sources.push(getSonarrClients);
  if (scopes.has('music.view')) sources.push(getLidarrClients);
  const instances = (await Promise.all(sources.map((getClients) => getClients()))).flat();
  if (instances.length === 0) return null;
  // One instance that does not answer must not blank the others.
  const perInstance = await Promise.all(instances.map(({ client }) => client.getDiskSpace().catch(() => {
    state.failed = true;
    return [] as DiskSpace[];
  })));
  const disks = dedupeDiskSpace(perInstance.flat().filter((disk): disk is DiskSpace => Boolean(disk)));
  return {
    freeBytes: disks.reduce((sum, disk) => sum + disk.freeSpace, 0),
    totalBytes: disks.reduce((sum, disk) => sum + disk.totalSpace, 0),
    disks: disks.map((disk) => ({ path: disk.path, label: disk.label || null, freeBytes: disk.freeSpace, totalBytes: disk.totalSpace })),
  };
}

async function readUpcoming(now: Date) {
  const end = new Date(now.getTime() + UPCOMING_DAYS * 24 * 60 * 60 * 1000);
  const result = await fetchServiceCalendarEvents(now.toISOString(), end.toISOString());
  if (!result.cacheable) throw new Error('No calendar instance answered');
  return result.events
    .filter((event) => new Date(event.date).getTime() >= now.getTime())
    .slice(0, UPCOMING_LIMIT)
    .map((event) => ({ type: event.type, title: event.title, subtitle: event.subtitle, date: event.date }));
}

async function readStreams() {
  const client = await getJellyfinClient();
  return { active: (await client.getActiveSessions()).length };
}

async function readQueueTotal(includeLidarr: boolean) {
  const result = await getQueueCached(1, QUEUE_ITEM_LIMIT, { includeLidarr });
  // A count missing an instance would read as fewer downloads than there are.
  if (result.partial) throw new Error('A queue instance did not answer');
  return { total: result.totalRecords };
}

async function readSharedSections(scopes: ReadonlySet<Capability>, includeLidarr: boolean, now: Date): Promise<SharedSections> {
  const key = [...scopes].filter((scope) => scope !== 'notifications.view').sort().join(',')
    + (includeLidarr ? '' : '|no-lidarr');
  const cached = await getCachedJson<SharedSections>(CACHE_SCOPE, `summary|${key}`);
  if (cached) return cached;

  const state = { failed: false };
  const hasStorage = scopes.has('movies.view') || scopes.has('series.view') || scopes.has('music.view');
  const [downloads, queue, storage, upcoming, streams] = await Promise.all([
    scopes.has('torrents.view') ? section(readDownloads, state) : undefined,
    scopes.has('activity.view') ? section(() => readQueueTotal(includeLidarr), state) : undefined,
    hasStorage ? section(() => readStorage(scopes, state), state) : undefined,
    scopes.has('calendar.view') ? section(() => readUpcoming(now), state) : undefined,
    scopes.has('jellyfin.sessions') ? section(readStreams, state) : undefined,
  ]);
  const sections: SharedSections = {
    ...(downloads !== undefined ? { downloads } : {}),
    ...(queue !== undefined ? { queue } : {}),
    ...(storage !== undefined ? { storage } : {}),
    ...(upcoming !== undefined ? { upcoming } : {}),
    ...(streams !== undefined ? { streams } : {}),
  };
  // A section that did not answer is served live but not pinned for the window.
  if (!state.failed) await setCachedJson(CACHE_SCOPE, `summary|${key}`, sections, CACHE_TTL_SECONDS);
  return sections;
}

/** The summary for these scopes (already narrowed to what the owner holds). */
export async function buildStatusSummary(user: User, scopes: ReadonlySet<Capability>, now: Date = new Date()): Promise<StatusSummary> {
  const [shared, alerts] = await Promise.all([
    // Lidarr's downloads are music: counted only while the owner may see the music library.
    readSharedSections(scopes, can(user, 'music.view'), now),
    scopes.has('notifications.view')
      ? section(async () => ({
        // The same scoping as the nav badge, so the count matches what the owner sees.
        unread: await prisma.notificationHistory.count({ where: { read: false, ...historyScope(user) } }),
      }), { failed: false })
      : undefined,
  ]);
  return {
    version: STATUS_API_VERSION,
    generatedAt: now.toISOString(),
    ...shared,
    ...(alerts !== undefined ? { alerts } : {}),
  };
}

function episodeLabel(item: QueueItem): string | null {
  const season = item.episode?.seasonNumber ?? item.seasonNumber;
  const episode = item.episode?.episodeNumber ?? item.episodeNumber;
  if (typeof season !== 'number' || typeof episode !== 'number') return null;
  return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
}

function mediaTitle(item: QueueItem): string {
  return item.series?.title ?? item.movie?.title ?? item.artist?.artistName ?? item.title;
}

export function toStatusQueueItem(item: QueueItem): StatusQueueItem {
  const size = Number(item.size) || 0;
  const left = Number(item.sizeleft) || 0;
  return {
    source: item.source ?? null,
    instance: item.instanceLabel ?? null,
    title: mediaTitle(item),
    episode: episodeLabel(item),
    status: item.trackedDownloadState || item.status,
    progress: size > 0 ? Math.round(Math.min(100, Math.max(0, ((size - left) / size) * 100))) : 0,
    sizeBytes: size,
    sizeLeftBytes: left,
    timeLeft: item.timeleft || null,
    estimatedCompletion: item.estimatedCompletionTime || null,
  };
}

function completionTime(item: StatusQueueItem): number {
  const time = item.estimatedCompletion ? new Date(item.estimatedCompletion).getTime() : NaN;
  return Number.isFinite(time) ? time : Infinity;
}

/**
 * The combined download queue: the first QUEUE_ITEM_LIMIT items, soonest to
 * finish first (those with no estimate last), across every instance. Lidarr's
 * downloads only while the owner may see the music library.
 */
export async function buildStatusQueue(user: User, now: Date = new Date()): Promise<StatusQueue> {
  const result = await getQueueCached(1, QUEUE_ITEM_LIMIT, { includeLidarr: can(user, 'music.view') });
  const items = result.records.map(toStatusQueueItem).sort((a, b) => completionTime(a) - completionTime(b));
  return {
    version: STATUS_API_VERSION,
    generatedAt: now.toISOString(),
    total: result.totalRecords,
    partial: result.partial === true,
    items: items.slice(0, QUEUE_ITEM_LIMIT),
  };
}
