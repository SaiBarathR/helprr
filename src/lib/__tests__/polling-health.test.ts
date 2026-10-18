import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));

const { nextSourceHealth, pollingService } = await import('@/lib/polling-service');

const AT = '2026-10-18T10:00:00.000Z';

describe('nextSourceHealth', () => {
  it('stamps successes and failures, keeping the latest error', () => {
    const first = nextSourceHealth(new Map(), [
      { source: 'pollSonarr', status: 'fulfilled' },
      { source: 'pollRadarr', status: 'rejected', error: 'x'.repeat(400) },
    ], AT);
    expect(first.get('pollSonarr')).toEqual({ lastSuccessAt: AT, lastFailureAt: null, lastError: null });
    expect(first.get('pollRadarr')!.lastFailureAt).toBe(AT);
    expect(first.get('pollRadarr')!.lastError).toHaveLength(300);
  });

  it('does not count a job skipped behind its own earlier run as a success', () => {
    const before = new Map([['pollJellyfin', { lastSuccessAt: '2026-10-18T09:00:00.000Z', lastFailureAt: null, lastError: null }]]);
    const after = nextSourceHealth(before, [{ source: 'pollJellyfin', status: 'skipped' }], AT);
    expect(after.get('pollJellyfin')!.lastSuccessAt).toBe('2026-10-18T09:00:00.000Z');
    expect(before.get('pollJellyfin')!.lastSuccessAt).toBe('2026-10-18T09:00:00.000Z');
  });

  it('keeps a failed job\'s error after a later success, so recency decides', () => {
    const failed = nextSourceHealth(new Map(), [{ source: 'pollSeerr', status: 'rejected', error: 'timeout' }], '2026-10-18T09:00:00.000Z');
    const recovered = nextSourceHealth(failed, [{ source: 'pollSeerr', status: 'fulfilled' }], AT);
    expect(recovered.get('pollSeerr')).toEqual({ lastSuccessAt: AT, lastFailureAt: '2026-10-18T09:00:00.000Z', lastError: 'timeout' });
  });
});

describe('pollingService.getHealth', () => {
  it('reports a stopped service with no cycle yet', () => {
    expect(pollingService.getHealth()).toEqual({ running: false, intervalMs: null, cycleInProgress: false, lastCycle: null, sources: [] });
  });
});
