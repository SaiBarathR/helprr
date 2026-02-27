import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient, getRadarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import type { HistoryItem } from '@/types';

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
export async function GET(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

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
    const sourceFilter = source === 'sonarr' || source === 'radarr' ? source : undefined;

    // Fetch large batches from both services so we can merge and re-sort
    const fetchSize = 500;

    const [sonarrResult, radarrResult] = await Promise.allSettled([
      (async () => {
        if (sourceFilter === 'radarr') return null;
        // Skip Sonarr fetch if filtering by movieId only
        if (movieId && !episodeId && !seriesId) return null;
        try {
          const sonarr = await getSonarrClient();
          return await sonarr.getHistory(1, fetchSize, sortKey, sortDirection, {
            episodeId,
            seriesId,
            eventType: resolveUpstreamEventType('sonarr', eventTypeFilter),
          });
        } catch {
          return null;
        }
      })(),
      (async () => {
        if (sourceFilter === 'sonarr') return null;
        // Skip Radarr fetch if filtering by episodeId/seriesId only
        if ((episodeId || seriesId) && !movieId) return null;
        try {
          const radarr = await getRadarrClient();
          return await radarr.getHistory(1, fetchSize, sortKey, sortDirection, {
            movieId,
            eventType: resolveUpstreamEventType('radarr', eventTypeFilter),
          });
        } catch {
          return null;
        }
      })(),
    ]);

    const sonarrData =
      sonarrResult.status === 'fulfilled' && sonarrResult.value
        ? sonarrResult.value
        : { records: [], totalRecords: 0 };

    const radarrData =
      radarrResult.status === 'fulfilled' && radarrResult.value
        ? radarrResult.value
        : { records: [], totalRecords: 0 };

    const sonarrRecords = sonarrData.records.map((record: HistoryItem) => ({
      ...record,
      source: 'sonarr' as const,
    }));

    const radarrRecords = radarrData.records.map((record: HistoryItem) => ({
      ...record,
      source: 'radarr' as const,
    }));

    let mergedRecords = [...sonarrRecords, ...radarrRecords];

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

    // Enrich Sonarr rows with episode data by matching episode IDs in one batched call.
    const sonarrEpisodeIds = Array.from(
      new Set(
        paginatedRecords
          .filter(
            (record): record is (HistoryItem & { source: 'sonarr'; episodeId: number }) =>
              record.source === 'sonarr'
              && typeof record.episodeId === 'number'
              && Number.isFinite(record.episodeId)
          )
          .map((record) => record.episodeId)
      )
    );

    if (sonarrEpisodeIds.length > 0) {
      try {
        const sonarr = await getSonarrClient();
        const episodes = await sonarr.getEpisodesByIds(sonarrEpisodeIds);
        const episodeById = new Map(episodes.map((episode) => [episode.id, episode]));
        paginatedRecords = paginatedRecords.map((record) => {
          if (record.source !== 'sonarr' || typeof record.episodeId !== 'number') return record;
          const episode = episodeById.get(record.episodeId);
          if (!episode) return record;
          return { ...record, episode };
        });
      } catch {
        // Keep history usable even if enrichment fails.
      }
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
