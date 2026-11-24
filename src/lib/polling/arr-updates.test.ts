import { beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from './__fixtures__/arr-updates.json';
import type { ArrUpdate } from '@/types';

const mocks = vi.hoisted(() => ({
  notify: vi.fn<(event: unknown, context?: unknown) => Promise<number | null>>(async () => 1),
  wanted: vi.fn(async (notices: unknown[]) => notices),
  redis: new Map<string, string>(),
  sonarr: [] as unknown[],
  prowlarr: null as unknown,
}));

vi.mock('@/lib/redis', () => ({
  getRedisClient: async () => ({
    get: async (key: string) => mocks.redis.get(key) ?? null,
    set: async (key: string, value: string) => { mocks.redis.set(key, value); },
  }),
}));
vi.mock('./shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./shared')>()),
  notifyAndLog: mocks.notify,
  wantedNotices: mocks.wanted,
}));
vi.mock('@/lib/service-helpers', () => ({
  getSonarrClients: async () => mocks.sonarr,
  getRadarrClients: async () => [],
  getLidarrClients: async () => [],
  getProwlarrClient: async () => {
    if (!mocks.prowlarr) {
      const { ConfigurationError } = await import('@/lib/config-error');
      throw new ConfigurationError('Prowlarr is not configured');
    }
    return mocks.prowlarr;
  },
}));
vi.mock('@/lib/arr-instances', () => ({ getDefaultConnection: async () => ({ id: 'p1', label: 'Prowlarr' }) }));

import { availableUpdate, checkArrUpdates } from './arr-updates';

const lists = fixture as unknown as Record<'sonarr' | 'radarr' | 'lidarr' | 'prowlarr', ArrUpdate[]>;
const sonarr = (id: string, label: string, updates: () => Promise<ArrUpdate[]>) => ({ connection: { id, label }, client: { getUpdates: vi.fn(updates) } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redis.clear();
  mocks.sonarr = [];
  mocks.prowlarr = null;
});

describe('which release is an update (real /update lists)', () => {
  it('Prowlarr 3.0.2 running with 3.1.0 out is an update; the others run their latest', () => {
    expect(availableUpdate(lists.prowlarr)).toEqual({ version: '3.1.0.5799', installedVersion: '3.0.2.5780' });
    expect(availableUpdate(lists.sonarr)).toBeNull();
    expect(availableUpdate(lists.radarr)).toBeNull();
    expect(availableUpdate(lists.lidarr)).toBeNull();
  });

  it('a running release newer than the one marked latest (another branch) is not behind', () => {
    const [latest, older] = lists.prowlarr;
    expect(availableUpdate([{ ...older, version: '3.2.0.1', installed: true }, latest])).toBeNull();
    // Running one too old to be listed: still behind.
    expect(availableUpdate([latest])).toEqual({ version: '3.1.0.5799', installedVersion: null });
    expect(availableUpdate([])).toBeNull();
  });
});

describe('checkArrUpdates', () => {
  it('tells admins once per version and instance, naming the instance when there are several', async () => {
    mocks.sonarr = [
      sonarr('s1', 'Main', async () => lists.prowlarr),
      sonarr('s2', 'Anime', async () => lists.sonarr),
    ];
    mocks.prowlarr = { getUpdates: vi.fn(async () => lists.prowlarr) };
    expect(await checkArrUpdates()).toBe(true);
    expect(mocks.notify.mock.calls.map(([event]) => event)).toEqual([
      expect.objectContaining({
        eventType: 'arrUpdateAvailable',
        title: 'Main · Sonarr update available',
        body: 'Sonarr 3.1.0.5799 is out (this one runs 3.0.2.5780).',
        url: '/settings/status',
        dedupeKey: 'arrUpdateAvailable:s1:3.1.0.5799',
      }),
      expect.objectContaining({ title: 'Prowlarr update available', body: 'Prowlarr 3.1.0.5799 is out (this one runs 3.0.2.5780).', dedupeKey: 'arrUpdateAvailable:p1:3.1.0.5799' }),
    ]);

    // The next day: nothing new, so nothing again, even with the history rows gone.
    mocks.notify.mockClear();
    expect(await checkArrUpdates()).toBe(true);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('asks no app while nobody takes the event, and looks again within the hour', async () => {
    const getUpdates = vi.fn(async () => lists.prowlarr);
    mocks.sonarr = [{ connection: { id: 's1', label: 'Main' }, client: { getUpdates } }];
    mocks.wanted.mockResolvedValueOnce([]);
    expect(await checkArrUpdates()).toBe(false);
    expect(getUpdates).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('an app that cannot be read asks for a retry; the others are still told, and not again on it', async () => {
    mocks.sonarr = [
      sonarr('s1', 'Main', async () => { throw new Error('ECONNREFUSED'); }),
      sonarr('s2', 'Anime', async () => lists.prowlarr),
    ];
    expect(await checkArrUpdates()).toBe(false);
    expect(mocks.notify).toHaveBeenCalledOnce();
    mocks.notify.mockClear();
    await checkArrUpdates();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('remembers nothing when the notification could not be recorded, so the next check tries again', async () => {
    mocks.sonarr = [sonarr('s1', 'Main', async () => lists.prowlarr)];
    mocks.notify.mockResolvedValueOnce(null);
    await checkArrUpdates();
    await checkArrUpdates();
    expect(mocks.notify).toHaveBeenCalledTimes(2);
  });
});
