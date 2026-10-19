import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ radarr: vi.fn(async () => [] as unknown[]) }));

vi.mock('@/lib/service-helpers', () => ({
  getSonarrClients: async () => [],
  getRadarrClients: mocks.radarr,
  getLidarrClients: async () => [],
}));
vi.mock('@/lib/cache/json-cache', () => ({ getCachedJson: async () => null, setCachedJson: async () => {} }));
vi.mock('@/lib/redis', () => ({ getRedisClient: async () => ({ get: async () => null, incr: async () => 1 }) }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { getQueueCached, getQueueNeedingImportCached } from '@/lib/activity-queue';

// 450 downloads; the one waiting on a manual import is the last, on the third page of 200.
const queue = Array.from({ length: 450 }, (_, n) => ({
  id: n + 1,
  title: `Film.${n}`,
  trackedDownloadState: n === 449 ? 'importPending' : 'downloading',
  trackedDownloadStatus: n === 449 ? 'warning' : 'ok',
}));
const client = {
  getQueue: vi.fn(async (page: number, pageSize: number) => ({ records: queue.slice((page - 1) * pageSize, page * pageSize), totalRecords: queue.length })),
};

describe('Activity queue reads', () => {
  it('finds downloads waiting on a manual import anywhere in the whole queue', async () => {
    mocks.radarr.mockResolvedValue([{ connection: { id: 'r1', label: 'Radarr' }, client }]);

    const result = await getQueueNeedingImportCached();

    expect(result.totalRecords).toBe(1);
    expect(result.records).toEqual([expect.objectContaining({ id: 450, source: 'radarr', instanceId: 'r1' })]);
    expect(client.getQueue.mock.calls.map(([page]) => page)).toEqual([1, 2, 3]);
  });

  it('still serves one page of each instance for the Queue tab', async () => {
    mocks.radarr.mockResolvedValue([{ connection: { id: 'r1', label: 'Radarr' }, client }]);

    const result = await getQueueCached(2, 50);

    expect(result.records.map((r) => r.id)).toEqual(Array.from({ length: 50 }, (_, n) => 51 + n));
    expect(result.totalRecords).toBe(450);
  });

  it('skips an instance that just failed on the next pages, instead of waiting on it for each', async () => {
    const down = { getQueue: vi.fn(async () => { throw new Error('timeout of 30000ms exceeded'); }) };
    mocks.radarr.mockResolvedValue([
      { connection: { id: 'r1', label: 'Radarr' }, client },
      { connection: { id: 'r-down', label: 'Down' }, client: down },
    ]);

    await getQueueCached(1, 50);
    const second = await getQueueCached(2, 50);

    expect(down.getQueue).toHaveBeenCalledOnce();
    expect(second.records).toHaveLength(50);
  });
});
