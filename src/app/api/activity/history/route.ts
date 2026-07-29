import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient, getSonarrClients, getRadarrClients, getLidarrClients } from '@/lib/service-helpers';
import type { SonarrClient } from '@/lib/sonarr-client';
import { requireAuth, requireCapability } from '@/lib/auth';
import type { HistoryItem } from '@/types';
import { withApiLogging } from '@/lib/api-logger';
import {
  ACTIVITY_HISTORY_MAX_WINDOW,
  ACTIVITY_HISTORY_SOURCE_CONCURRENCY,
  fetchActivityHistorySource,
  mapSettledWithLimit,
  mergeActivityHistory,
  type ActivityHistorySource,
  type ActivityHistorySourceDescriptor,
} from '@/lib/activity-history';

const HISTORY_CACHE_HEADERS = {
  'Cache-Control': 'private, max-age=60, stale-while-revalidate=120',
  // Partition the private cache by session cookie so a capability-gated response can't be
  // replayed from the browser cache to a different (or logged-out) user within the TTL.
  'Vary': 'Cookie',
} as const;

type HistorySource = 'sonarr' | 'radarr';
type CanonicalHistoryEvent =
  | 'grabbed'
  | 'imported'
  | 'failed'
  | 'deleted'
  | 'renamed'
  | 'ignored';

type ParsedEventTypeFilter =
  | { kind: 'none' }
  | { kind: 'canonical'; value: CanonicalHistoryEvent }
  | { kind: 'numeric'; value: number }
  | { kind: 'raw'; value: string };

type SortDirection = 'ascending' | 'descending';
const ACTIVITY_HISTORY_MAX_PAGE_SIZE = 500;

interface ParsedHistoryQuery {
  page: number;
  pageSize: number;
  sortDirection: SortDirection;
  eventTypeFilter: ParsedEventTypeFilter;
  episodeId?: number;
  seriesId?: number;
  movieId?: number;
  sourceFilter?: ActivityHistorySource;
  instanceId?: string;
}

const CANONICAL_EVENT_SET = new Set<CanonicalHistoryEvent>([
  'grabbed',
  'imported',
  'failed',
  'deleted',
  'renamed',
  'ignored',
]);

// Lidarr history uses string event types (no numeric eventType filter like Sonarr/Radarr),
// so its rows are fetched unfiltered and narrowed to a canonical filter locally.
const LIDARR_EVENTS_BY_CANONICAL: Record<CanonicalHistoryEvent, string[]> = {
  grabbed: ['grabbed'],
  imported: ['downloadImported', 'trackFileImported'],
  failed: ['downloadFailed', 'albumImportIncomplete'],
  deleted: ['trackFileDeleted'],
  renamed: ['trackFileRenamed'],
  ignored: ['downloadIgnored'],
};

const LEGACY_EVENT_ALIASES: Record<string, CanonicalHistoryEvent> = {
  grabbed: 'grabbed',
  downloadfolderimported: 'imported',
  episodefileimported: 'imported',
  moviefileimported: 'imported',
  downloadfailed: 'failed',
  episodefiledeleted: 'deleted',
  moviefiledeleted: 'deleted',
  renamed: 'renamed',
  episodefilerenamed: 'renamed',
  moviefilerenamed: 'renamed',
  downloadignored: 'ignored',
};

const EVENT_CODE_BY_SOURCE: Record<HistorySource, Record<CanonicalHistoryEvent, number>> = {
  sonarr: {
    grabbed: 1,
    imported: 3,
    failed: 4,
    deleted: 5,
    renamed: 6,
    ignored: 7,
  },
  radarr: {
    grabbed: 1,
    imported: 3,
    failed: 4,
    deleted: 6,
    renamed: 8,
    ignored: 9,
  },
};

function parseEventTypeFilter(raw: string | null): ParsedEventTypeFilter {
  if (!raw) return { kind: 'none' };

  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === 'all') return { kind: 'none' };

  if (/^\d+$/.test(trimmed)) {
    const numericValue = Number.parseInt(trimmed, 10);
    if (Number.isFinite(numericValue)) return { kind: 'numeric', value: numericValue };
  }

  const normalized = trimmed.toLowerCase();
  const alias = LEGACY_EVENT_ALIASES[normalized];
  if (alias) return { kind: 'canonical', value: alias };
  if (CANONICAL_EVENT_SET.has(normalized as CanonicalHistoryEvent)) {
    return { kind: 'canonical', value: normalized as CanonicalHistoryEvent };
  }

  return { kind: 'raw', value: normalized };
}

function resolveUpstreamEventType(
  source: HistorySource,
  filter: ParsedEventTypeFilter
): number | undefined {
  if (filter.kind === 'numeric') return filter.value;
  if (filter.kind === 'canonical') return EVENT_CODE_BY_SOURCE[source][filter.value];
  return undefined;
}

function parsePositiveInt(raw: string | null, fallback?: number): number | undefined {
  if (raw === null || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function parseHistoryQuery(searchParams: URLSearchParams):
  | { ok: true; value: ParsedHistoryQuery }
  | { ok: false; error: string } {
  const page = parsePositiveInt(searchParams.get('page'), 1);
  const pageSize = parsePositiveInt(searchParams.get('pageSize'), 50);
  if (!page) return { ok: false, error: 'page must be a positive integer' };
  if (!pageSize || pageSize > ACTIVITY_HISTORY_MAX_PAGE_SIZE) {
    return {
      ok: false,
      error: `pageSize must be an integer between 1 and ${ACTIVITY_HISTORY_MAX_PAGE_SIZE}`,
    };
  }
  if (page * pageSize > ACTIVITY_HISTORY_MAX_WINDOW) {
    return {
      ok: false,
      error: `requested history window exceeds ${ACTIVITY_HISTORY_MAX_WINDOW} records`,
    };
  }

  const sortKey = searchParams.get('sortKey') ?? 'date';
  if (sortKey !== 'date') return { ok: false, error: 'sortKey must be date' };
  const direction = searchParams.get('sortDirection') ?? 'descending';
  if (direction !== 'ascending' && direction !== 'descending') {
    return { ok: false, error: 'sortDirection must be ascending or descending' };
  }

  const source = searchParams.get('source');
  if (source && source !== 'sonarr' && source !== 'radarr' && source !== 'lidarr') {
    return { ok: false, error: 'source must be sonarr, radarr, or lidarr' };
  }

  const eventRaw = searchParams.get('eventType');
  if (eventRaw && eventRaw.length > 64) {
    return { ok: false, error: 'eventType is too long' };
  }
  const eventTypeFilter = parseEventTypeFilter(eventRaw);
  if (
    eventTypeFilter.kind === 'raw'
    && !/^[a-z][a-z0-9_-]*$/i.test(eventTypeFilter.value)
  ) {
    return { ok: false, error: 'eventType is invalid' };
  }

  const parseOptionalId = (name: 'episodeId' | 'seriesId' | 'movieId') => {
    const raw = searchParams.get(name);
    const value = parsePositiveInt(raw);
    return { raw, value };
  };
  const episode = parseOptionalId('episodeId');
  const series = parseOptionalId('seriesId');
  const movie = parseOptionalId('movieId');
  for (const [name, parsed] of [
    ['episodeId', episode],
    ['seriesId', series],
    ['movieId', movie],
  ] as const) {
    if (parsed.raw !== null && parsed.value === undefined) {
      return { ok: false, error: `${name} must be a positive integer` };
    }
  }

  const instanceRaw = searchParams.get('instanceId');
  const instanceId = instanceRaw?.trim() || undefined;
  if (instanceId && instanceId.length > 128) {
    return { ok: false, error: 'instanceId is too long' };
  }

  return {
    ok: true,
    value: {
      page,
      pageSize,
      sortDirection: direction,
      eventTypeFilter,
      episodeId: episode.value,
      seriesId: series.value,
      movieId: movie.value,
      sourceFilter: source as ActivityHistorySource | undefined,
      instanceId,
    },
  };
}

/**
 * Retrieve merged and optionally filtered history records from Sonarr, Radarr, and Lidarr.
 *
 * Accepts the following query parameters on the provided request URL:
 * - `page` (default 1) — 1-based page number.
 * - `pageSize` (default 50) — number of records per page.
 * - `sortKey` (default "date") — field to sort by.
 * - `sortDirection` (default "descending") — "ascending" or "descending".
 * - `eventType` — optional canonical event filter (`grabbed`, `imported`, `failed`, `deleted`, `renamed`, `ignored`), legacy eventType string, or upstream numeric code.
 * - `episodeId`, `seriesId`, `movieId` — numeric IDs used to narrow the fetch to relevant records.
 * - `source` — "sonarr", "radarr", or "lidarr" to restrict fetching to one service.
 *
 * @param request - NextRequest whose URL search params control filtering, sorting, and pagination.
 * @returns A bounded page with total exactness, continuation, and partial-result metadata.
 */
async function getHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('activity.view');
  if (capError) return capError;

  try {
    const { searchParams } = new URL(request.url);
    const parsed = parseHistoryQuery(searchParams);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const {
      page,
      pageSize,
      sortDirection,
      eventTypeFilter,
      episodeId,
      seriesId,
      movieId,
      sourceFilter,
      instanceId,
    } = parsed.value;
    const endIndex = page * pageSize;
    const startIndex = (page - 1) * pageSize;

    // Optional per-instance scope: an instanceId belongs to exactly one type, so the
    // other services' client lists filter down to empty and contribute no records.
    const scopeToInstance = <T extends { connection: { id: string } }>(list: T[]): T[] =>
      instanceId ? list.filter((x) => x.connection.id === instanceId) : list;

    const includeSonarr =
      sourceFilter !== 'radarr'
      && sourceFilter !== 'lidarr'
      && !(movieId && !episodeId && !seriesId);
    const includeRadarr =
      sourceFilter !== 'sonarr'
      && sourceFilter !== 'lidarr'
      && !((episodeId || seriesId) && !movieId);
    const includeLidarr =
      sourceFilter !== 'sonarr'
      && sourceFilter !== 'radarr'
      && !episodeId
      && !seriesId
      && !movieId
      && eventTypeFilter.kind !== 'numeric';

    const clientLoads = await Promise.allSettled([
      includeSonarr ? getSonarrClients() : Promise.resolve([]),
      includeRadarr ? getRadarrClients() : Promise.resolve([]),
      includeLidarr ? getLidarrClients() : Promise.resolve([]),
    ] as const);
    const failedSources = new Set<ActivityHistorySource>();
    const descriptors: ActivityHistorySourceDescriptor[] = [];

    const [sonarrLoad, radarrLoad, lidarrLoad] = clientLoads;
    if (sonarrLoad.status === 'rejected') {
      if (includeSonarr) failedSources.add('sonarr');
    } else {
      const localFilter = eventTypeFilter.kind === 'raw'
        ? (record: HistoryItem) =>
            record.eventType.toLowerCase() === eventTypeFilter.value
        : undefined;
      for (const { connection, client } of scopeToInstance(sonarrLoad.value)) {
        descriptors.push({
          source: 'sonarr',
          instanceId: connection.id,
          instanceLabel: connection.label,
          fetchPage: (upstreamPage, upstreamPageSize) =>
            client.getHistory(upstreamPage, upstreamPageSize, 'date', sortDirection, {
              episodeId,
              seriesId,
              eventType: resolveUpstreamEventType('sonarr', eventTypeFilter),
            }),
          localFilter,
        });
      }
    }

    if (radarrLoad.status === 'rejected') {
      if (includeRadarr) failedSources.add('radarr');
    } else {
      const localFilter = eventTypeFilter.kind === 'raw'
        ? (record: HistoryItem) =>
            record.eventType.toLowerCase() === eventTypeFilter.value
        : undefined;
      for (const { connection, client } of scopeToInstance(radarrLoad.value)) {
        descriptors.push({
          source: 'radarr',
          instanceId: connection.id,
          instanceLabel: connection.label,
          fetchPage: (upstreamPage, upstreamPageSize) =>
            client.getHistory(upstreamPage, upstreamPageSize, 'date', sortDirection, {
              movieId,
              eventType: resolveUpstreamEventType('radarr', eventTypeFilter),
            }),
          localFilter,
        });
      }
    }

    if (lidarrLoad.status === 'rejected') {
      if (includeLidarr) failedSources.add('lidarr');
    } else {
      let localFilter: ActivityHistorySourceDescriptor['localFilter'];
      if (eventTypeFilter.kind === 'canonical') {
        const allowed = new Set(
          LIDARR_EVENTS_BY_CANONICAL[eventTypeFilter.value].map((event) =>
            event.toLowerCase()
          )
        );
        localFilter = (record) => allowed.has(record.eventType.toLowerCase());
      } else if (eventTypeFilter.kind === 'raw') {
        localFilter = (record) =>
          record.eventType.toLowerCase() === eventTypeFilter.value;
      }

      for (const { connection, client } of scopeToInstance(lidarrLoad.value)) {
        descriptors.push({
          source: 'lidarr',
          instanceId: connection.id,
          instanceLabel: connection.label,
          fetchPage: (upstreamPage, upstreamPageSize) =>
            client.getHistory(
              upstreamPage,
              upstreamPageSize,
              'date',
              sortDirection
            ),
          localFilter,
        });
      }
    }

    const sourceResults = await mapSettledWithLimit(
      descriptors,
      ACTIVITY_HISTORY_SOURCE_CONCURRENCY,
      (descriptor) => fetchActivityHistorySource(descriptor, endIndex),
    );
    const successfulSources = sourceResults.flatMap((result, index) => {
      if (result.status === 'fulfilled') return [result.value];
      failedSources.add(descriptors[index].source);
      return [];
    });

    if (successfulSources.length === 0 && failedSources.size > 0) {
      return NextResponse.json(
        {
          error: 'Failed to fetch history',
          partial: true,
          failedSources: [...failedSources],
        },
        { status: 502 },
      );
    }

    const mergedRecords = mergeActivityHistory(
      successfulSources.map((result) => result.records),
      endIndex,
      sortDirection,
    );
    let paginatedRecords = mergedRecords.slice(startIndex, startIndex + pageSize);
    const totalRecords = successfulSources.reduce(
      (sum, result) => sum + result.totalRecords,
      0,
    );
    const totalRecordsExact =
      failedSources.size === 0
      && successfulSources.every((result) => result.totalRecordsExact);
    const moreRecordsAvailable =
      successfulSources.reduce((sum, result) => sum + result.records.length, 0)
        > endIndex
      || successfulSources.some((result) => result.hasMore);
    const requestWindowTruncated =
      moreRecordsAvailable && endIndex >= ACTIVITY_HISTORY_MAX_WINDOW;
    const truncated =
      requestWindowTruncated
      || successfulSources.some((result) => result.truncated);
    const hasMore = moreRecordsAvailable && !requestWindowTruncated;

    // Enrich Sonarr rows with episode data, grouped by the originating instance
    // (episode ids are per-instance, so each batch must hit its own Sonarr).
    const sonarrRows = paginatedRecords.filter(
      (record): record is (HistoryItem & { source: 'sonarr'; episodeId: number; instanceId: string; instanceLabel: string }) =>
        record.source === 'sonarr'
        && typeof record.episodeId === 'number'
        && Number.isFinite(record.episodeId)
    );

    if (sonarrRows.length > 0) {
      const idsByInstance = new Map<string, Set<number>>();
      for (const record of sonarrRows) {
        const key = record.instanceId ?? '';
        const set = idsByInstance.get(key) ?? new Set<number>();
        set.add(record.episodeId);
        idsByInstance.set(key, set);
      }

      const episodeByKey = new Map<string, Awaited<ReturnType<SonarrClient['getEpisodesByIds']>>[number]>();
      await Promise.all(
        [...idsByInstance.entries()].map(async ([instanceKey, ids]) => {
          try {
            const sonarr = await getSonarrClient(instanceKey || undefined);
            const episodes = await sonarr.getEpisodesByIds([...ids]);
            for (const episode of episodes) episodeByKey.set(`${instanceKey}:${episode.id}`, episode);
          } catch {
            // Keep history usable even if enrichment fails.
          }
        })
      );

      paginatedRecords = paginatedRecords.map((record) => {
        if (record.source !== 'sonarr' || typeof record.episodeId !== 'number') return record;
        const episode = episodeByKey.get(`${record.instanceId ?? ''}:${record.episodeId}`);
        if (!episode) return record;
        return { ...record, episode };
      });
    }

    return NextResponse.json({
      page,
      pageSize,
      totalRecords,
      totalRecordsExact,
      hasMore,
      truncated,
      partial: failedSources.size > 0,
      failedSources: [...failedSources],
      records: paginatedRecords,
    }, { headers: HISTORY_CACHE_HEADERS });
  } catch (error) {
    console.error('Failed to fetch history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch history' },
      { status: 500 }
    );
  }
}

export const GET = withApiLogging(getHandler, 'api/activity/history');
