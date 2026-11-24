import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigurationError } from '@/lib/config-error';

const mocks = vi.hoisted(() => ({
  getHealth: vi.fn(),
  getProwlarrClient: vi.fn(),
  getDefaultConnection: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  notifyAndLog: vi.fn(),
  noteJobFailure: vi.fn(),
}));

vi.mock('@/lib/service-helpers', () => ({ getProwlarrClient: mocks.getProwlarrClient }));
vi.mock('@/lib/arr-instances', () => ({ getDefaultConnection: mocks.getDefaultConnection }));
vi.mock('@/lib/db', () => ({ prisma: { pollingState: { upsert: mocks.upsert, update: mocks.update } } }));
vi.mock('@/lib/polling-job-report', () => ({ noteJobFailure: mocks.noteJobFailure }));
vi.mock('./shared', () => ({ notifyAndLog: mocks.notifyAndLog }));

import { pollProwlarr } from './poll-prowlarr';
import { HEALTH_CLEAR_HOLD_MS, resetHealthTracking } from './health-transition';

let saves = 0;
const warning = (message: string) => ({ source: 'IndexerStatusCheck', type: 'warning', message, wikiUrl: '' });

/** Runs one cycle from a stored hash and returns the hash it saved. */
async function cycle(lastHealthHash: string | null, health: unknown[]) {
  mocks.upsert.mockResolvedValue({ lastHealthHash, updatedAt: new Date(`2026-10-30T00:00:0${++saves % 10}Z`) });
  mocks.getHealth.mockResolvedValue(health);
  mocks.update.mockClear();
  await pollProwlarr();
  return mocks.update.mock.calls[0]?.[0].data.lastHealthHash as string;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetHealthTracking();
  mocks.getProwlarrClient.mockResolvedValue({ getHealth: mocks.getHealth });
  mocks.getDefaultConnection.mockResolvedValue({ id: 'prowlarr-1' });
});

describe('pollProwlarr', () => {
  it('records the first run without notifying', async () => {
    const hash = await cycle(null, [warning('Indexers unavailable: A')]);

    expect(hash).toEqual(expect.any(String));
    expect(mocks.notifyAndLog).not.toHaveBeenCalled();
  });

  it('notifies once on a change, then stays quiet for the same list in any order', async () => {
    const first = await cycle(null, [warning('A failing')]);
    const second = await cycle(first, [warning('A failing'), warning('B failing')]);
    expect(mocks.notifyAndLog).toHaveBeenCalledTimes(1);
    expect(mocks.notifyAndLog.mock.calls[0][0]).toEqual({
      eventType: 'healthWarning',
      title: 'Prowlarr Health Warning',
      body: 'A failing; B failing',
      url: '/prowlarr',
      metadata: { source: 'prowlarr', redirect: '/prowlarr' },
      dedupeKey: expect.stringMatching(/^prowlarr-health:/),
    });

    await cycle(second, [warning('B failing'), warning('A failing')]);
    expect(mocks.notifyAndLog).toHaveBeenCalledTimes(1);
  });

  it('sends one restored push once health has stayed clear for the hold, then stays quiet', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-24T10:00:00Z') });
    try {
      const failing = await cycle(null, [warning('A failing')]);
      // Clear, but not yet for the hold: nothing sent, the old hash kept.
      expect(await cycle(failing, [])).toBe(failing);
      vi.advanceTimersByTime(HEALTH_CLEAR_HOLD_MS);
      const clear = await cycle(failing, []);
      expect(clear).not.toBe(failing);
      expect(mocks.notifyAndLog).toHaveBeenCalledTimes(1);
      expect(mocks.notifyAndLog.mock.calls[0][0]).toEqual({
        eventType: 'healthRestored',
        title: 'Prowlarr Health Restored',
        body: 'All health checks pass again',
        url: '/prowlarr',
        metadata: { source: 'prowlarr', redirect: '/prowlarr' },
        dedupeKey: expect.stringMatching(/^prowlarr-health-restored:/),
      });

      vi.advanceTimersByTime(HEALTH_CLEAR_HOLD_MS);
      await cycle(clear, []);
      expect(mocks.notifyAndLog).toHaveBeenCalledTimes(1);

      // The same warning coming back later is a new warning.
      await cycle(clear, [warning('A failing')]);
      expect(mocks.notifyAndLog).toHaveBeenCalledTimes(2);
      expect(mocks.notifyAndLog.mock.calls[1][0].eventType).toBe('healthWarning');
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends nothing when a warning clears and returns inside the hold', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-24T10:00:00Z') });
    try {
      const failing = await cycle(null, [warning('A failing')]);
      await cycle(failing, []);
      vi.advanceTimersByTime(HEALTH_CLEAR_HOLD_MS - 1000);
      expect(await cycle(failing, [warning('A failing')])).toBe(failing);
      vi.advanceTimersByTime(HEALTH_CLEAR_HOLD_MS);
      // The hold starts again from the next clear poll.
      expect(await cycle(failing, [])).toBe(failing);
      expect(mocks.notifyAndLog).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('never sends a restored push when the first poll already found health clear', async () => {
    const clear = await cycle(null, []);
    await cycle(clear, []);
    expect(mocks.notifyAndLog).not.toHaveBeenCalled();
  });

  it('retries a restored push that could not be recorded on the next cycle', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-24T10:00:00Z') });
    try {
      const failing = await cycle(null, [warning('A failing')]);
      await cycle(failing, []);
      vi.advanceTimersByTime(HEALTH_CLEAR_HOLD_MS);
      mocks.notifyAndLog.mockResolvedValueOnce(null);
      await cycle(failing, []);
      expect(mocks.update).not.toHaveBeenCalled();

      const clear = await cycle(failing, []);
      expect(clear).not.toBe(failing);
      expect(mocks.notifyAndLog).toHaveBeenCalledTimes(2);
      expect(mocks.notifyAndLog.mock.calls[1][0].eventType).toBe('healthRestored');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the old hash when the notification could not be recorded, so it retries', async () => {
    const first = await cycle(null, []);
    mocks.notifyAndLog.mockResolvedValueOnce(null);

    await cycle(first, [warning('A failing')]);

    expect(mocks.notifyAndLog).toHaveBeenCalledTimes(1);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('saves the hash when the event was recorded but no device received it', async () => {
    const first = await cycle(null, []);
    mocks.notifyAndLog.mockResolvedValueOnce(0);

    const saved = await cycle(first, [warning('A failing')]);

    expect(saved).not.toBe(first);
  });

  it('repeats the dedupe key after a failed hash save, and uses a new one once saved', async () => {
    const first = await cycle(null, []);
    const row = { lastHealthHash: first, updatedAt: new Date('2026-10-30T01:00:00Z') };
    mocks.upsert.mockResolvedValue(row);
    mocks.getHealth.mockResolvedValue([warning('A failing')]);
    mocks.update.mockRejectedValueOnce(new Error('write failed'));

    await expect(pollProwlarr()).rejects.toThrow('write failed');
    await pollProwlarr();
    const [key1, key2] = mocks.notifyAndLog.mock.calls.map((call) => call[0].dedupeKey);
    expect(key2).toBe(key1);

    mocks.upsert.mockResolvedValue({ ...row, updatedAt: new Date('2026-10-30T02:00:00Z') });
    await pollProwlarr();
    expect(mocks.notifyAndLog.mock.calls[2][0].dedupeKey).not.toBe(key1);
  });

  it('removes credentials and caps the body at 200 characters', async () => {
    const first = await cycle(null, []);
    await cycle(first, [warning(`Proxy failed at https://proxy.example/v1?apikey=secret-value ${'x'.repeat(300)}`)]);

    const body = mocks.notifyAndLog.mock.calls[0][0].body as string;
    expect(body).not.toContain('secret-value');
    expect(body).toContain('https://proxy.example');
    expect(body).toHaveLength(200);
  });

  it('skips quietly when Prowlarr is not configured', async () => {
    mocks.getProwlarrClient.mockRejectedValue(new ConfigurationError('not configured'));

    await pollProwlarr();

    expect(mocks.noteJobFailure).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('reports a failed read and keeps the stored hash', async () => {
    mocks.upsert.mockResolvedValue({ lastHealthHash: 'old' });
    mocks.getHealth.mockRejectedValue(new Error('unreachable'));

    await pollProwlarr();

    expect(mocks.noteJobFailure).toHaveBeenCalledOnce();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.notifyAndLog).not.toHaveBeenCalled();
  });
});
