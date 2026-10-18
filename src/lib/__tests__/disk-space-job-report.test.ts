import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/service-helpers', () => ({
  getRadarrClients: async () => [{ client: { getDiskSpace: async () => { throw new Error('Radarr disk read refused'); } } }],
  getSonarrClients: async () => [{ client: { getDiskSpace: async () => [{ path: '/tv', freeSpace: 1, totalSpace: 2 }] } }],
  getLidarrClients: async () => [],
}));

import { jobReports, type JobReport } from '@/lib/polling-job-report';
import { getAggregatedDiskSpace } from '@/lib/disk-space';

// A disk job keeps the disks it could read, and still reports that one instance
// failed; a service with no instances is not a failure.
describe('disk space and the polling job report', () => {
  it('reports a configured instance whose disk read failed', async () => {
    const report: JobReport = { failure: null, skipped: false };
    const disks = await jobReports.run(report, () => getAggregatedDiskSpace());
    expect(disks).toHaveLength(1);
    expect(report.failure).toBe('Radarr disk read refused');
  });
});
