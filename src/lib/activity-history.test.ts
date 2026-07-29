import { describe, expect, it, vi } from 'vitest';
import type { HistoryItem, HistoryResponse } from '@/types';
import {
  fetchActivityHistorySource,
  mapSettledWithLimit,
  mergeActivityHistory,
  type ActivityHistoryRecord,
  type ActivityHistorySourceDescriptor,
} from '@/lib/activity-history';

function historyItem(
  id: number,
  date: string,
  eventType = 'grabbed',
): HistoryItem {
  return {
    id,
    sourceTitle: `Item ${id}`,
    quality: { quality: { name: 'Test' } },
    qualityCutoffNotMet: false,
    date,
    eventType,
    data: {},
  };
}

function historyResponse(
  records: HistoryItem[],
  totalRecords: number,
  page = 1,
  pageSize = records.length,
): HistoryResponse {
  return {
    page,
    pageSize,
    sortKey: 'date',
    sortDirection: 'descending',
    totalRecords,
    records,
  };
}

function descriptor(
  overrides: Partial<ActivityHistorySourceDescriptor> = {},
): ActivityHistorySourceDescriptor {
  return {
    source: 'sonarr',
    instanceId: 'sonarr-1',
    instanceLabel: 'Sonarr',
    fetchPage: vi.fn(),
    ...overrides,
  };
}

describe('activity history source fetching', () => {
  it('requests only the required native-filter window and keeps the upstream total', async () => {
    const fetchPage = vi.fn().mockResolvedValue(
      historyResponse(
        Array.from({ length: 20 }, (_, index) =>
          historyItem(index + 1, `2026-07-29T00:${String(index).padStart(2, '0')}:00Z`)
        ),
        250,
      ),
    );

    const result = await fetchActivityHistorySource(
      descriptor({ fetchPage }),
      20,
    );

    expect(fetchPage).toHaveBeenCalledOnce();
    expect(fetchPage).toHaveBeenCalledWith(1, 20);
    expect(result).toMatchObject({
      totalRecords: 250,
      totalRecordsExact: true,
      hasMore: true,
      truncated: false,
    });
    expect(result.records).toHaveLength(20);
    expect(result.records[0]).toMatchObject({
      source: 'sonarr',
      instanceId: 'sonarr-1',
      instanceLabel: 'Sonarr',
    });
  });

  it('incrementally scans a local filter and reports an exact filtered total', async () => {
    const first = Array.from({ length: 100 }, (_, index) =>
      historyItem(index + 1, `2026-07-29T00:00:${String(index).padStart(2, '0')}Z`,
        index % 20 === 0 ? 'downloadImported' : 'grabbed')
    );
    const second = Array.from({ length: 20 }, (_, index) =>
      historyItem(index + 101, `2026-07-28T00:00:${String(index).padStart(2, '0')}Z`,
        index % 10 === 0 ? 'downloadImported' : 'grabbed')
    );
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(historyResponse(first, 120, 1, 100))
      .mockResolvedValueOnce(historyResponse(second, 120, 2, 100));

    const result = await fetchActivityHistorySource(
      descriptor({
        source: 'lidarr',
        fetchPage,
        localFilter: (record) => record.eventType === 'downloadImported',
      }),
      20,
    );

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(result.records).toHaveLength(7);
    expect(result).toMatchObject({
      source: 'lidarr',
      totalRecords: 7,
      totalRecordsExact: true,
      hasMore: false,
    });
  });

  it('keeps exact local totals truthful when more filtered rows exist', async () => {
    const records = Array.from({ length: 30 }, (_, index) =>
      historyItem(index + 1, `2026-07-29T00:00:${String(index).padStart(2, '0')}Z`)
    );
    const result = await fetchActivityHistorySource(
      descriptor({
        source: 'lidarr',
        fetchPage: vi.fn().mockResolvedValue(historyResponse(records, 30)),
        localFilter: () => true,
      }),
      20,
    );

    expect(result.records).toHaveLength(20);
    expect(result).toMatchObject({
      totalRecords: 30,
      totalRecordsExact: true,
      hasMore: true,
    });
  });

  it('marks a locally filtered total inexact when the requested window fills early', async () => {
    const records = Array.from({ length: 100 }, (_, index) =>
      historyItem(index + 1, `2026-07-29T00:00:${String(index).padStart(2, '0')}Z`)
    );
    const result = await fetchActivityHistorySource(
      descriptor({
        source: 'lidarr',
        fetchPage: vi.fn().mockResolvedValue(historyResponse(records, 1_000)),
        localFilter: () => true,
      }),
      20,
    );

    expect(result.records).toHaveLength(20);
    expect(result).toMatchObject({
      totalRecords: 100,
      totalRecordsExact: false,
      hasMore: true,
    });
  });

  it('does not promise another page after an inconclusive full safety scan', async () => {
    const fetchPage = vi.fn().mockImplementation(
      (page: number, pageSize: number) =>
        Promise.resolve(historyResponse(
          Array.from({ length: pageSize }, (_, index) =>
            historyItem(
              (page - 1) * pageSize + index,
              '2026-07-29T00:00:00Z',
              'grabbed',
            )
          ),
          6_000,
          page,
          pageSize,
        )),
    );

    const result = await fetchActivityHistorySource(
      descriptor({
        source: 'lidarr',
        fetchPage,
        localFilter: (record) => record.eventType === 'downloadImported',
      }),
      20,
    );

    expect(fetchPage).toHaveBeenCalledTimes(50);
    expect(result).toMatchObject({
      records: [],
      totalRecords: 0,
      totalRecordsExact: false,
      hasMore: false,
      truncated: true,
    });
  });

  it('stops after an empty upstream page without promising continuation', async () => {
    const fetchPage = vi.fn().mockResolvedValue(historyResponse([], 100, 1, 100));

    const result = await fetchActivityHistorySource(
      descriptor({
        source: 'lidarr',
        fetchPage,
        localFilter: () => true,
      }),
      20,
    );

    expect(fetchPage).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      totalRecordsExact: false,
      hasMore: false,
      truncated: false,
    });
  });
});

describe('activity history bounded concurrency', () => {
  it('preserves result order and never exceeds the configured worker limit', async () => {
    let active = 0;
    let maximumActive = 0;
    const items = [1, 2, 3, 4, 5, 6, 7];

    const results = await mapSettledWithLimit(items, 3, async (item) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      active -= 1;
      if (item === 4) throw new Error('source failed');
      return item * 10;
    });

    expect(maximumActive).toBe(3);
    expect(results.map((result) =>
      result.status === 'fulfilled' ? result.value : 'rejected'
    )).toEqual([10, 20, 30, 'rejected', 50, 60, 70]);
  });
});

describe('activity history merge', () => {
  function tagged(
    source: ActivityHistoryRecord['source'],
    id: number,
    timestamp: number,
  ): ActivityHistoryRecord {
    return {
      ...historyItem(id, new Date(timestamp).toISOString()),
      source,
      instanceId: `${source}-1`,
      instanceLabel: source,
    };
  }

  it.each(['ascending', 'descending'] as const)(
    'matches a full-sort oracle for generated sources in %s order',
    (direction) => {
      let seed = 42;
      const random = () => {
        seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
        return seed;
      };
      const sources = (['sonarr', 'radarr', 'lidarr'] as const).map(
        (source, sourceIndex) =>
          Array.from({ length: 80 }, (_, index) =>
            tagged(source, sourceIndex * 100 + index, random() % 25)
          ),
      );
      const compare = (a: ActivityHistoryRecord, b: ActivityHistoryRecord) => {
        const difference =
          new Date(a.date).getTime() - new Date(b.date).getTime();
        return direction === 'ascending' ? difference : -difference;
      };
      const oracle = sources.flat().sort(compare).slice(0, 65);

      expect(mergeActivityHistory(sources, 65, direction)).toEqual(oracle);
    },
  );

  it('returns only the requested merged prefix for empty sources and date ties', () => {
    const tied = [
      tagged('sonarr', 1, 100),
      tagged('radarr', 2, 100),
      tagged('lidarr', 3, 100),
    ];

    expect(mergeActivityHistory([[tied[0]], [], tied.slice(1)], 2, 'descending'))
      .toEqual(tied.slice(0, 2));
  });
});
