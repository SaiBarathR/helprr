import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/recommendations/build-profile', () => ({ buildTasteProfile: vi.fn(() => ({})) }));
vi.mock('@/lib/recommendations/signals', () => ({
  collectJellyfinSignals: vi.fn(async () => { throw new Error('Jellyfin answered 500'); }),
  collectAniListSignals: vi.fn(async () => ({ available: false, engagedTitles: [], planned: [], listedAnilistIds: new Set() })),
  collectWatchlistSignals: vi.fn(async () => ({ available: false, items: [], itemKeys: new Set() })),
  collectEventSignals: vi.fn(async () => ({ hasEvents: false })),
}));

import { jobReports, type JobReport } from '@/lib/polling-job-report';
import { buildProfileForUser } from '@/lib/recommendations/profile-store';

describe('building a taste profile inside a polling job', () => {
  it('still builds without Jellyfin, and reports the failed read to the job', async () => {
    const report: JobReport = { failure: null, skipped: false };

    const built = await jobReports.run(report, () => buildProfileForUser({ id: 'u1', role: 'member', jellyfinUserId: 'jf1' }));

    expect(built.profile).toEqual({});
    expect(report.failure).toBe('Jellyfin answered 500');
  });
});
