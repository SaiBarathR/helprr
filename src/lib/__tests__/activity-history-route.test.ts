import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { HistoryItem, HistoryResponse } from '@/types';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireCapability: vi.fn(),
  getSonarrClient: vi.fn(),
  getSonarrClients: vi.fn(),
  getRadarrClients: vi.fn(),
  getLidarrClients: vi.fn(),
  sonarrHistory: vi.fn(),
  radarrHistory: vi.fn(),
  lidarrHistory: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireAuth: mocks.requireAuth,
  requireCapability: mocks.requireCapability,
}));
vi.mock('@/lib/api-logger', () => ({
  withApiLogging: (handler: unknown) => handler,
}));
vi.mock('@/lib/service-helpers', () => ({
  getSonarrClient: mocks.getSonarrClient,
  getSonarrClients: mocks.getSonarrClients,
  getRadarrClients: mocks.getRadarrClients,
  getLidarrClients: mocks.getLidarrClients,
}));

import { GET } from '@/app/api/activity/history/route';

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
  sourceOffset: number,
  pageSize: number,
  totalRecords = 100,
): HistoryResponse {
  return {
    page: 1,
    pageSize,
    sortKey: 'date',
    sortDirection: 'descending',
    totalRecords,
    records: Array.from({ length: pageSize }, (_, index) =>
      historyItem(
        sourceOffset + index,
        new Date(Date.UTC(2026, 6, 29, 0, 0, sourceOffset + index)).toISOString(),
      )
    ),
  };
}

const request = (query = '') =>
  new NextRequest(`http://localhost/api/activity/history${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(null);
  mocks.requireCapability.mockResolvedValue(null);
  mocks.getSonarrClient.mockResolvedValue({ getEpisodesByIds: vi.fn() });
  mocks.sonarrHistory.mockImplementation(
    (_page: number, pageSize: number) =>
      Promise.resolve(historyResponse(100, pageSize)),
  );
  mocks.radarrHistory.mockImplementation(
    (_page: number, pageSize: number) =>
      Promise.resolve(historyResponse(200, pageSize)),
  );
  mocks.lidarrHistory.mockImplementation(
    (_page: number, pageSize: number) =>
      Promise.resolve(historyResponse(300, pageSize)),
  );
  mocks.getSonarrClients.mockResolvedValue([{
    connection: { id: 'sonarr-1', label: 'Sonarr' },
    client: { getHistory: mocks.sonarrHistory },
  }]);
  mocks.getRadarrClients.mockResolvedValue([{
    connection: { id: 'radarr-1', label: 'Radarr' },
    client: { getHistory: mocks.radarrHistory },
  }]);
  mocks.getLidarrClients.mockResolvedValue([{
    connection: { id: 'lidarr-1', label: 'Lidarr' },
    client: { getHistory: mocks.lidarrHistory },
  }]);
});

describe('activity history route', () => {
  it('bounds the common first page, merges concurrently, and sums native totals', async () => {
    const response = await GET(request('?page=1&pageSize=20'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.sonarrHistory).toHaveBeenCalledWith(
      1, 20, 'date', 'descending', expect.any(Object),
    );
    expect(mocks.radarrHistory).toHaveBeenCalledWith(
      1, 20, 'date', 'descending', expect.any(Object),
    );
    expect(mocks.lidarrHistory).toHaveBeenCalledWith(
      1, 20, 'date', 'descending',
    );
    expect(body).toMatchObject({
      page: 1,
      pageSize: 20,
      totalRecords: 300,
      totalRecordsExact: true,
      hasMore: true,
      truncated: false,
      partial: false,
      failedSources: [],
    });
    expect(body.records).toHaveLength(20);
    expect(body.records[0]).toMatchObject({
      source: 'lidarr',
      instanceId: 'lidarr-1',
      instanceLabel: 'Lidarr',
    });
  });

  it('starts all service families before any upstream history resolves', async () => {
    const releases: Array<(value: HistoryResponse) => void> = [];
    const deferred = () => vi.fn(
      () => new Promise<HistoryResponse>((resolve) => {
        releases.push((value) => resolve(value));
      }),
    );
    const sonarr = deferred();
    const radarr = deferred();
    const lidarr = deferred();
    mocks.getSonarrClients.mockResolvedValue([{
      connection: { id: 'sonarr-1', label: 'Sonarr' },
      client: { getHistory: sonarr },
    }]);
    mocks.getRadarrClients.mockResolvedValue([{
      connection: { id: 'radarr-1', label: 'Radarr' },
      client: { getHistory: radarr },
    }]);
    mocks.getLidarrClients.mockResolvedValue([{
      connection: { id: 'lidarr-1', label: 'Lidarr' },
      client: { getHistory: lidarr },
    }]);

    const pending = GET(request('?pageSize=20'));
    await vi.waitFor(() => {
      expect(sonarr).toHaveBeenCalledOnce();
      expect(radarr).toHaveBeenCalledOnce();
      expect(lidarr).toHaveBeenCalledOnce();
    });
    releases[0](historyResponse(100, 20));
    releases[1](historyResponse(200, 20));
    releases[2](historyResponse(300, 20));

    await expect(pending).resolves.toMatchObject({ status: 200 });
  });

  it.each([
    ['?page=0', 'page must be a positive integer'],
    ['?pageSize=501', 'pageSize must be an integer between 1 and 500'],
    ['?page=51&pageSize=100', 'requested history window exceeds 5000 records'],
    ['?sortKey=id', 'sortKey must be date'],
    ['?sortDirection=sideways', 'sortDirection must be ascending or descending'],
    ['?source=unknown', 'source must be sonarr, radarr, or lidarr'],
    ['?eventType=bad%20filter', 'eventType is invalid'],
  ])('rejects invalid query %s before loading service clients', async (query, error) => {
    const response = await GET(request(query));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error });
    expect(mocks.getSonarrClients).not.toHaveBeenCalled();
    expect(mocks.getRadarrClients).not.toHaveBeenCalled();
    expect(mocks.getLidarrClients).not.toHaveBeenCalled();
  });

  it('loads only the requested service and preserves ascending pagination', async () => {
    const response = await GET(
      request('?source=sonarr&page=2&pageSize=10&sortDirection=ascending'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getSonarrClients).toHaveBeenCalledOnce();
    expect(mocks.getRadarrClients).not.toHaveBeenCalled();
    expect(mocks.getLidarrClients).not.toHaveBeenCalled();
    expect(mocks.sonarrHistory).toHaveBeenCalledWith(
      1, 20, 'date', 'ascending', expect.any(Object),
    );
    expect(body.records).toHaveLength(10);
    expect(body.records[0].source).toBe('sonarr');
  });

  it('preserves the bounded 500-row notification lookup contract', async () => {
    const response = await GET(
      request('?source=sonarr&eventType=imported&page=1&pageSize=500'),
    );

    expect(response.status).toBe(200);
    expect(mocks.sonarrHistory).toHaveBeenCalledWith(
      1, 500, 'date', 'descending', expect.any(Object),
    );
  });

  it('returns useful non-secret partial results when one source fails', async () => {
    mocks.radarrHistory.mockRejectedValue(new Error('secret upstream URL'));

    const response = await GET(request('?pageSize=10'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      totalRecords: 200,
      totalRecordsExact: false,
      partial: true,
      failedSources: ['radarr'],
    });
    expect(JSON.stringify(body)).not.toContain('secret upstream URL');
  });

  it('returns a non-secret gateway failure when every selected source fails', async () => {
    mocks.sonarrHistory.mockRejectedValue(new Error('secret upstream URL'));

    const response = await GET(request('?source=sonarr'));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to fetch history',
      partial: true,
      failedSources: ['sonarr'],
    });
  });

  it('applies canonical Lidarr filters incrementally with exact metadata', async () => {
    mocks.getSonarrClients.mockResolvedValue([]);
    mocks.getRadarrClients.mockResolvedValue([]);
    mocks.lidarrHistory.mockResolvedValue({
      ...historyResponse(300, 3, 3),
      records: [
        historyItem(1, '2026-07-29T03:00:00Z', 'downloadImported'),
        historyItem(2, '2026-07-29T02:00:00Z', 'grabbed'),
        historyItem(3, '2026-07-29T01:00:00Z', 'trackFileImported'),
      ],
    });

    const response = await GET(request('?eventType=imported&pageSize=20'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.records.map((record: HistoryItem) => record.id)).toEqual([1, 3]);
    expect(body).toMatchObject({
      totalRecords: 2,
      totalRecordsExact: true,
      hasMore: false,
    });
  });

  it('surfaces an incomplete local-filter scan without promising another page', async () => {
    mocks.getSonarrClients.mockResolvedValue([]);
    mocks.getRadarrClients.mockResolvedValue([]);
    mocks.lidarrHistory.mockImplementation(
      (page: number, pageSize: number) =>
        Promise.resolve({
          ...historyResponse(300, pageSize, 6_000),
          page,
          records: Array.from({ length: pageSize }, (_, index) =>
            historyItem(
              (page - 1) * pageSize + index,
              '2026-07-29T00:00:00Z',
              'grabbed',
            )
          ),
        }),
    );

    const response = await GET(request('?eventType=imported&pageSize=20'));

    await expect(response.json()).resolves.toMatchObject({
      totalRecordsExact: false,
      hasMore: false,
      truncated: true,
      records: [],
    });
  });
});
