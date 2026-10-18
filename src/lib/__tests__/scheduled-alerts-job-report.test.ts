import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: { scheduledAlert: { findMany: vi.fn(async () => [{ id: 'alert-1', offsetMinutes: 30 }]) } } }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/notification-service', () => ({ notifyEvent: vi.fn() }));
vi.mock('@/lib/scheduled-alerts/resolver', () => ({
  createResolverContext: vi.fn(() => ({})),
  resolveAlertOccurrencesResult: vi.fn(async () => { throw new Error('TMDB unavailable'); }),
}));

import { jobReports, type JobReport } from '@/lib/polling-job-report';
import { refreshScheduledAlertOccurrences } from '@/lib/scheduled-alerts/delivery';

// The polling job carries on past one alert it could not refresh, and the
// health view still sees that the job failed.
describe('scheduled alerts and the polling job report', () => {
  it('reports a refresh failure to the running job', async () => {
    const report: JobReport = { failure: null, skipped: false };
    await jobReports.run(report, () => refreshScheduledAlertOccurrences());
    expect(report.failure).toBe('TMDB unavailable');
  });
});
