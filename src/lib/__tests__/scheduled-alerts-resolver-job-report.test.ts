import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getSonarrClients: vi.fn() }));

vi.mock('@/lib/service-helpers', () => ({ getSonarrClients: mocks.getSonarrClients, getRadarrClients: vi.fn(async () => []) }));
vi.mock('@/lib/anilist-client', () => ({ getAnimeNextAiringEpisode: vi.fn() }));

import type { ScheduledAlert } from '@prisma/client';
import { jobReports, type JobReport } from '@/lib/polling-job-report';
import { createResolverContext, resolveAlertOccurrencesResult } from '@/lib/scheduled-alerts/resolver';

// One instance answering is enough to resolve the alert, but the polling job
// that asked the other one still failed.
describe('resolving a scheduled alert across instances', () => {
  it('reports an instance that did not answer even when another did', async () => {
    mocks.getSonarrClients.mockResolvedValue([
      { connection: { id: 's1' }, client: { getCalendar: async () => { throw new Error('Sonarr answered 500'); } } },
      { connection: { id: 's2' }, client: { getCalendar: async () => [] } },
    ]);
    const alert = {
      scheduleMode: 'release_relative', source: 'SONARR', mediaType: 'series', externalId: '1', title: 'Show',
      subtitle: null, posterUrl: null, href: null, instanceId: null, metadata: {}, scope: 'series',
      releaseTypes: ['episode'], offsetMinutes: 0, timeZone: 'UTC',
    } as unknown as ScheduledAlert;
    const report: JobReport = { failure: null, skipped: false };

    const result = await jobReports.run(report, () => resolveAlertOccurrencesResult(alert, createResolverContext()));

    expect(result).toEqual({ candidates: [], resolved: true });
    expect(report.failure).toBe('Sonarr answered 500');
  });
});
