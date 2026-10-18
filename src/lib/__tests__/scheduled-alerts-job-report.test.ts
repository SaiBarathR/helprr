import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), upsert: vi.fn(), update: vi.fn() }));

vi.mock('@/lib/db', () => ({
  prisma: {
    scheduledAlert: { findMany: vi.fn(async () => [{ id: 'alert-1', offsetMinutes: 30 }]), update: mocks.update },
    scheduledAlertOccurrence: { findMany: vi.fn(async () => []), upsert: vi.fn(), deleteMany: vi.fn(), updateMany: vi.fn() },
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/notification-service', () => ({ notifyEvent: vi.fn() }));
vi.mock('@/lib/scheduled-alerts/resolver', () => ({
  createResolverContext: vi.fn(() => ({})),
  resolveAlertOccurrencesResult: mocks.resolve,
}));

import { prisma } from '@/lib/db';
import { jobReports, type JobReport } from '@/lib/polling-job-report';
import { checkScheduledAlerts, refreshScheduledAlertOccurrences } from '@/lib/scheduled-alerts/delivery';

// The polling job carries on past one alert it could not refresh, and the
// health view still sees that the job failed.
describe('scheduled alerts and the polling job report', () => {
  it('reports a refresh failure to the running job', async () => {
    mocks.resolve.mockRejectedValueOnce(new Error('TMDB unavailable'));
    const report: JobReport = { failure: null, skipped: false };
    await jobReports.run(report, () => refreshScheduledAlertOccurrences());
    expect(report.failure).toBe('TMDB unavailable');
  });
});

describe('an unresolved scheduled alert', () => {
  it('counts as a failure, as a release source it needs did not answer', async () => {
    mocks.resolve.mockResolvedValueOnce({ candidates: [], resolved: false });
    const report: JobReport = { failure: null, skipped: false };
    await jobReports.run(report, () => refreshScheduledAlertOccurrences().catch(() => undefined));
    expect(report.failure).toBe('A release source for a scheduled alert did not answer');
  });
});

// A cycle with nothing to do keeps the job's last result, so it cannot hide a failure.
describe('scheduled alert jobs with nothing to do', () => {
  it('counts a refresh with no alerts due as skipped', async () => {
    vi.mocked(prisma.scheduledAlert.findMany).mockResolvedValueOnce([]);
    const report: JobReport = { failure: null, skipped: false };
    await jobReports.run(report, () => refreshScheduledAlertOccurrences());
    expect(report).toEqual({ failure: null, skipped: true });
  });

  it('counts a delivery with no reminders due as skipped', async () => {
    const report: JobReport = { failure: null, skipped: false };
    await jobReports.run(report, () => checkScheduledAlerts());
    expect(report).toEqual({ failure: null, skipped: true });
  });
});
