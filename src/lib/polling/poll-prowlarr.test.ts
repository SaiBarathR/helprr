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

const warning = (message: string) => ({ source: 'IndexerStatusCheck', type: 'warning', message, wikiUrl: '' });

/** Runs one cycle from a stored hash and returns the hash it saved. */
async function cycle(lastHealthHash: string | null, health: unknown[]) {
  mocks.upsert.mockResolvedValue({ lastHealthHash });
  mocks.getHealth.mockResolvedValue(health);
  mocks.update.mockClear();
  await pollProwlarr();
  return mocks.update.mock.calls[0]?.[0].data.lastHealthHash as string;
}

beforeEach(() => {
  vi.clearAllMocks();
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
    });

    await cycle(second, [warning('B failing'), warning('A failing')]);
    expect(mocks.notifyAndLog).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when health clears, and notifies when the same warning returns', async () => {
    const failing = await cycle(null, [warning('A failing')]);
    const clear = await cycle(failing, []);
    expect(mocks.notifyAndLog).not.toHaveBeenCalled();

    await cycle(clear, [warning('A failing')]);
    expect(mocks.notifyAndLog).toHaveBeenCalledTimes(1);
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
