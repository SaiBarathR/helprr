import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient, getSonarrClients, getRadarrClients, getLidarrClients } from '@/lib/service-helpers';
import type { SonarrClient } from '@/lib/sonarr-client';
import { requireAuth, requireCapability } from '@/lib/auth';
import type { HistoryItem } from '@/types';
import { withApiLogging } from '@/lib/api-logger';

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

/**
 * Retrieve merged and optionally filtered history records from Sonarr and Radarr and return a paginated JSON response.
 *
 * Accepts the following query parameters on the provided request URL:
 * - `page` (default 1) — 1-based page number.
 * - `pageSize` (default 50) — number of records per page.
 * - `sortKey` (default "date") — field to sort by.
 * - `sortDirection` (default "descending") — "ascending" or "descending".
 * - `eventType` — optional canonical event filter (`grabbed`, `imported`, `failed`, `deleted`, `renamed`, `ignored`), legacy eventType string, or upstream numeric code.
 * - `episodeId`, `seriesId`, `movieId` — numeric IDs used to narrow the fetch to relevant records.
 * - `source` — "sonarr" or "radarr" to restrict fetching to a single service.
 *
 * @param request - NextRequest whose URL search params control filtering, sorting, and pagination.
 * @returns An object with `page`, `pageSize`, `totalRecords`, and `records` (the page of merged history items).
 */
async function getHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;
  const capError = await requireCapability('activity.view');
  if (capError) return capError;

  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '50', 10);
    const sortKey = searchParams.get('sortKey') || 'date';
    const sortDirection = searchParams.get('sortDirection') || 'descending';
    const eventTypeFilter = parseEventTypeFilter(searchParams.get('eventType'));
    const episodeId = searchParams.get('episodeId') ? parseInt(searchParams.get('episodeId')!, 10) : undefined;
    const seriesId = searchParams.get('seriesId') ? parseInt(searchParams.get('seriesId')!, 10) : undefined;
    const movieId = searchParams.get('movieId') ? parseInt(searchParams.get('movieId')!, 10) : undefined;
    const source = searchParams.get('source');
    const sourceFilter = source === 'sonarr' || source === 'radarr' || source === 'lidarr' ? source : undefined;
    // Optional per-instance scope: an instanceId belongs to exactly one type, so the
    // other services' client lists filter down to empty and contribute no records.
    const instanceId = searchParams.get('instanceId') ?? undefined;
    const scopeToInstance = <T extends { connection: { id: string } }>(list: T[]): T[] =>
      instanceId ? list.filter((x) => x.connection.id === instanceId) : list;

    // Fetch large batches from every instance of both services so we can merge and re-sort
    const fetchSize = 500;

    const sonarrRecords =
      sourceFilter === 'radarr' || sourceFilter === 'lidarr' || (movieId && !episodeId && !seriesId)
        ? []
        : (
            await Promise.all(
              scopeToInstance(await getSonarrClients().catch(() => [])).map(async ({ connection, client }) => {
                try {
                  const res = await client.getHistory(1, fetchSize, sortKey, sortDirection, {
                    episodeId,
                    seriesId,
                    eventType: resolveUpstreamEventType('sonarr', eventTypeFilter),
                  });
                  return res.records.map((record: HistoryItem) => ({
                    ...record,
                    source: 'sonarr' as const,
                    instanceId: connection.id,
                    instanceLabel: connection.label,
                  }));
                } catch {
                  return [];
                }
              })
            )
          ).flat();

    const radarrRecords =
      sourceFilter === 'sonarr' || sourceFilter === 'lidarr' || ((episodeId || seriesId) && !movieId)
        ? []
        : (
            await Promise.all(
              scopeToInstance(await getRadarrClients().catch(() => [])).map(async ({ connection, client }) => {
                try {
                  const res = await client.getHistory(1, fetchSize, sortKey, sortDirection, {
                    movieId,
                    eventType: resolveUpstreamEventType('radarr', eventTypeFilter),
                  });
                  return res.records.map((record: HistoryItem) => ({
                    ...record,
                    source: 'radarr' as const,
                    instanceId: connection.id,
                    instanceLabel: connection.label,
                  }));
                } catch {
                  return [];
                }
              })
            )
          ).flat();

    let lidarrRecords =
      sourceFilter === 'sonarr' || sourceFilter === 'radarr' || episodeId || seriesId || movieId || eventTypeFilter.kind === 'numeric'
        ? []
        : (
            await Promise.all(
              scopeToInstance(await getLidarrClients().catch(() => [])).map(async ({ connection, client }) => {
                try {
                  const res = await client.getHistory(1, fetchSize, sortKey, sortDirection);
                  return res.records.map((record: HistoryItem) => ({
                    ...record,
                    source: 'lidarr' as const,
                    instanceId: connection.id,
                    instanceLabel: connection.label,
                  }));
                } catch {
                  return [];
                }
              })
            )
          ).flat();

    // Canonical filters are applied upstream for Sonarr/Radarr (numeric codes) but
    // must be applied locally for Lidarr (string event types). Raw filters fall
    // through to the shared post-merge filter below.
    if (eventTypeFilter.kind === 'canonical') {
      const allowed = new Set(
        LIDARR_EVENTS_BY_CANONICAL[eventTypeFilter.value].map((e) => e.toLowerCase())
      );
      lidarrRecords = lidarrRecords.filter((record) => allowed.has(record.eventType.toLowerCase()));
    }

    let mergedRecords = [...sonarrRecords, ...radarrRecords, ...lidarrRecords];

    // Sort by date descending
    mergedRecords.sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      return sortDirection === 'descending' ? dateB - dateA : dateA - dateB;
    });

    // Raw event filters (unknown aliases) are applied locally as a fallback.
    if (eventTypeFilter.kind === 'raw') {
      mergedRecords = mergedRecords.filter(
        (record) => record.eventType.toLowerCase() === eventTypeFilter.value
      );
    }

    const totalRecords = mergedRecords.length;

    // Manual pagination on the merged result
    const startIndex = (page - 1) * pageSize;
    let paginatedRecords = mergedRecords.slice(startIndex, startIndex + pageSize);

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
      records: paginatedRecords,
    });
  } catch (error) {
    console.error('Failed to fetch history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch history' },
      { status: 500 }
    );
  }
}

export const GET = withApiLogging(getHandler, 'api/activity/history');
