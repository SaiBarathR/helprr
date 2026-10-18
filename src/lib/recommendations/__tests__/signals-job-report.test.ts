import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findLink: vi.fn(),
  readAniList: vi.fn(),
  jellyfinContext: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: { userAniListLink: { findUnique: mocks.findLink } } }));
vi.mock('@/lib/anilist-oauth', () => ({ loadAniListConnection: vi.fn(async () => null) }));
vi.mock('@/lib/anilist-mutations', () => ({ fetchMediaListCollection: vi.fn() }));
vi.mock('@/lib/cache/anilist-api-cache', () => ({ getAnilistJsonWithCache: mocks.readAniList }));
vi.mock('@/lib/service-helpers', () => ({
  getJellyfinUserContext: mocks.jellyfinContext,
  isJellyfinUnavailable: (error: unknown) => (error as Error).message === 'not configured',
}));

import { jobReports, type JobReport } from '@/lib/polling-job-report';
import { collectAniListSignals, collectJellyfinSignals } from '@/lib/recommendations/signals';

const inJob = async (run: () => Promise<unknown>) => {
  const report: JobReport = { failure: null, skipped: false };
  await jobReports.run(report, run);
  return report;
};

beforeEach(() => {
  vi.clearAllMocks();
});

// A profile rebuilt without a source it should have read is saved, but the
// polling job that rebuilt it is reported as failed.
describe('taste-profile signals and the polling job report', () => {
  it('reports an AniList list that could not be read', async () => {
    mocks.findLink.mockResolvedValue({ anilistUserId: 7, scoreFormat: null });
    mocks.readAniList.mockRejectedValue(new Error('AniList answered 500'));

    const report = await inJob(async () => {
      expect(await collectAniListSignals({ id: 'u1', role: 'member' })).toEqual(expect.objectContaining({ available: false }));
    });

    expect(report.failure).toBe('AniList answered 500');
  });

  it('does not report a user with no AniList link', async () => {
    mocks.findLink.mockResolvedValue(null);

    const report = await inJob(() => collectAniListSignals({ id: 'u1', role: 'member' }));

    expect(report.failure).toBeNull();
    expect(mocks.readAniList).not.toHaveBeenCalled();
  });

  it('reports recent plays that could not be read, and keeps the rest', async () => {
    const queryItems = vi.fn(async (query: { IncludeItemTypes: string }) => {
      if (query.IncludeItemTypes === 'Episode,Movie') throw new Error('Jellyfin answered 500');
      return { Items: [] };
    });
    mocks.jellyfinContext.mockResolvedValue({ client: { queryItems, submitCustomQuery: async () => null }, jellyfinUserId: 'jf1' });

    const report = await inJob(async () => {
      expect(await collectJellyfinSignals({ role: 'member', jellyfinUserId: 'jf1' })).toEqual(expect.objectContaining({ available: true, recentPlays: [] }));
    });

    expect(report.failure).toBe('Jellyfin answered 500');
  });

  it('reports a Playback Reporting query that failed, not one whose plugin is missing', async () => {
    const queryItems = vi.fn(async () => ({ Items: [] }));
    const submitCustomQuery = vi.fn(async () => null as unknown);
    mocks.jellyfinContext.mockResolvedValue({ client: { queryItems, submitCustomQuery }, jellyfinUserId: 'jf1' });

    expect((await inJob(() => collectJellyfinSignals({ role: 'member', jellyfinUserId: 'jf1' }))).failure).toBeNull();

    submitCustomQuery.mockRejectedValueOnce(new Error('Playback Reporting answered 500'));
    expect((await inJob(() => collectJellyfinSignals({ role: 'member', jellyfinUserId: 'jf1' }))).failure).toBe('Playback Reporting answered 500');
  });

  it('leaves Jellyfin that is not set up to the empty signals, and lets a failed read throw', async () => {
    mocks.jellyfinContext.mockRejectedValueOnce(new Error('not configured'));
    expect(await inJob(() => collectJellyfinSignals({ role: 'member', jellyfinUserId: null }))).toEqual({ failure: null, skipped: false });

    mocks.jellyfinContext.mockRejectedValueOnce(new Error('Jellyfin answered 500'));
    await expect(collectJellyfinSignals({ role: 'member', jellyfinUserId: 'jf1' })).rejects.toThrow('Jellyfin answered 500');
  });
});
