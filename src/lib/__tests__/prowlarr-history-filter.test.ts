import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), create: vi.fn() }));
vi.mock('axios', () => ({
  default: { create: mocks.create.mockImplementation(() => ({ get: mocks.get })) },
}));

import { ProwlarrClient } from '@/lib/prowlarr-client';

const paramsOfLastCall = () => mocks.get.mock.calls.at(-1)?.[1]?.params as Record<string, unknown>;

describe('Prowlarr history: one indexer', () => {
  beforeEach(() => mocks.get.mockReset().mockResolvedValue({ data: { records: [], totalRecords: 0 } }));

  // Prowlarr ignores `indexerId` on /api/v1/history and returns every indexer's
  // rows; it filters only on `indexerIds` (checked on Prowlarr 2.7.0.5723).
  it('sends the indexer as indexerIds, the filter Prowlarr reads', async () => {
    const prowlarr = new ProwlarrClient('http://prowlarr.local', 'key');
    await prowlarr.getHistory({ page: 1, pageSize: 10, indexerId: 21 });
    expect(mocks.get).toHaveBeenLastCalledWith('/api/v1/history', expect.anything());
    expect(paramsOfLastCall()).toMatchObject({ page: 1, pageSize: 10, indexerIds: 21 });
    expect(paramsOfLastCall()).not.toHaveProperty('indexerId');
  });

  it('sends no indexer filter when none is asked for', async () => {
    const prowlarr = new ProwlarrClient('http://prowlarr.local', 'key');
    await prowlarr.getHistory({ page: 2, pageSize: 50, eventType: 1, successful: false });
    expect(paramsOfLastCall()).toEqual({ page: 2, pageSize: 50, eventType: 1, successful: false });
  });
});
