import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  reachable: new Map<string, boolean>(),
  probe: vi.fn(),
  notify: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    serviceConnection: {
      findMany: vi.fn(async () => [{ id: 'yt', type: 'YOUTUBE', label: 'YouTube' }]),
    },
    pollingState: {
      findMany: vi.fn(async () => [...mocks.reachable.entries()].map(([serviceConnectionId, lastReachable]) => ({
        serviceConnectionId, lastReachable,
      }))),
      upsert: vi.fn(async ({ where, update }: { where: { serviceConnectionId: string }; update: { lastReachable: boolean } }) => {
        mocks.reachable.set(where.serviceConnectionId, update.lastReachable);
      }),
    },
  },
}));
vi.mock('@/lib/service-health', () => ({ probeServiceHealth: mocks.probe, SERVICE_LABELS: { YOUTUBE: 'YouTube' } }));
vi.mock('./shared', () => ({ notifyAndLog: mocks.notify, errorMessage: String }));
vi.mock('@/lib/polling-job-report', () => ({ noteJobFailure: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), debug: vi.fn() } }));

import { pollServiceReachability, resetReachabilityTracking } from './service-reachability';

const START = Date.parse('2026-11-18T06:00:00.000Z');

/** One probe `atSecs` after START, with the given delay setting. */
async function probeAt(atSecs: number, ok: boolean, delaySecs = 120) {
  vi.setSystemTime(START + atSecs * 1000);
  mocks.probe.mockResolvedValueOnce(ok ? { ok: true } : { ok: false, error: 'connect EHOSTUNREACH' });
  const context = { getSettings: async () => ({ serviceDownAlertDelaySecs: delaySecs }) };
  await pollServiceReachability(context as never);
}

const sentEvents = () => mocks.notify.mock.calls.map(([payload]) => (payload as { eventType: string }).eventType);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  mocks.reachable = new Map([['yt', true]]);
  mocks.probe.mockReset();
  mocks.notify.mockReset();
  resetReachabilityTracking();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pollServiceReachability down-alert delay', () => {
  it('sends nothing for a blip shorter than the delay, and keeps the service reported up', async () => {
    await probeAt(0, false);
    await probeAt(15, false);
    await probeAt(105, false);
    expect(mocks.reachable.get('yt')).toBe(true);
    await probeAt(119, true);
    expect(sentEvents()).toEqual([]);
    expect(mocks.reachable.get('yt')).toBe(true);
  });

  it('alerts once the failures have lasted the delay, then says when it is back', async () => {
    await probeAt(0, false);
    await probeAt(105, false);
    expect(sentEvents()).toEqual([]);
    await probeAt(120, false);
    expect(sentEvents()).toEqual(['serviceDown']);
    expect(mocks.reachable.get('yt')).toBe(false);

    await probeAt(135, false);
    await probeAt(600, false);
    expect(sentEvents()).toEqual(['serviceDown']);

    await probeAt(615, true);
    expect(sentEvents()).toEqual(['serviceDown', 'serviceRestored']);
    expect(mocks.reachable.get('yt')).toBe(true);
  });

  it('starts the wait again after a successful check', async () => {
    await probeAt(0, false);
    await probeAt(90, false);
    await probeAt(105, true);
    await probeAt(120, false);
    await probeAt(225, false);
    expect(sentEvents()).toEqual([]);
    await probeAt(240, false);
    expect(sentEvents()).toEqual(['serviceDown']);
  });

  it('alerts at the first failed check when the delay is 0', async () => {
    await probeAt(0, false, 0);
    expect(sentEvents()).toEqual(['serviceDown']);
    await probeAt(15, true, 0);
    expect(sentEvents()).toEqual(['serviceDown', 'serviceRestored']);
  });

  it('uses a changed delay for a failure that is already pending', async () => {
    await probeAt(0, false);
    await probeAt(15, false);
    expect(sentEvents()).toEqual([]);
    await probeAt(30, false, 0);
    expect(sentEvents()).toEqual(['serviceDown']);
  });

  it('sends nothing more while a service already reported down keeps failing', async () => {
    mocks.reachable = new Map([['yt', false]]);
    await probeAt(0, false);
    await probeAt(600, false);
    expect(sentEvents()).toEqual([]);
    expect(mocks.reachable.get('yt')).toBe(false);
  });

  it('records a first-seen failing service as down without alerting', async () => {
    mocks.reachable = new Map();
    await probeAt(0, false);
    expect(sentEvents()).toEqual([]);
    expect(mocks.reachable.get('yt')).toBe(false);
  });
});
