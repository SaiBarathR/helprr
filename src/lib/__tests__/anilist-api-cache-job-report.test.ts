import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/redis', () => ({ getRedisClient: async () => ({ get: mocks.get, set: async () => 'OK' }) }));
vi.mock('@/lib/cache/state', () => ({
  getCacheGeneration: async () => 1,
  tryAcquireCacheLock: async () => 'token',
  releaseCacheLock: async () => true,
}));

import { getAnilistJsonWithCache } from '@/lib/cache/anilist-api-cache';
import { jobReports, type JobReport } from '@/lib/polling-job-report';

const entry = (expiresAt: number) => JSON.stringify({
  endpoint: 'mediaListCollection', keyHash: 'h', payload: { lists: ['cached'] },
  fetchedAt: Date.now() - 60_000, expiresAt, staleUntil: Date.now() + 60_000,
});

const inJob = async (fetcher: () => Promise<unknown>) => {
  const report: JobReport = { failure: null, skipped: false };
  const value = await jobReports.run(report, () => getAnilistJsonWithCache({ endpoint: 'mediaListCollection', fetcher }));
  return { value, report };
};

// Stale data stands in for a failed refresh, but a polling job that asked is told.
describe('AniList cache inside a polling job', () => {
  it('reports a refresh that failed while returning the stale copy', async () => {
    mocks.get.mockResolvedValueOnce(entry(Date.now() - 1_000));

    const { value, report } = await inJob(async () => { throw new Error('AniList answered 500'); });

    expect(value).toEqual({ lists: ['cached'] });
    expect(report.failure).toBe('AniList answered 500');
  });

  it('does not report a fresh cache hit', async () => {
    mocks.get.mockResolvedValueOnce(entry(Date.now() + 60_000));
    const fetcher = vi.fn();

    const { report } = await inJob(fetcher);

    expect(fetcher).not.toHaveBeenCalled();
    expect(report.failure).toBeNull();
  });
});
