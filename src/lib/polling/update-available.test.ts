import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  notify: vi.fn(async (): Promise<number | null> => 1),
  redis: new Map<string, string>(),
}));

vi.mock('@/lib/update-check', () => ({ checkForUpdates: mocks.check }));
vi.mock('@/lib/redis', () => ({
  getRedisClient: async () => ({
    get: async (key: string) => mocks.redis.get(key) ?? null,
    set: async (key: string, value: string) => { mocks.redis.set(key, value); },
  }),
}));
vi.mock('./shared', () => ({ notifyAndLog: mocks.notify }));

import { checkUpdateAvailable } from './update-available';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redis.clear();
});

describe('checkUpdateAvailable', () => {
  it('sends the admin event once per version through the dedupe key', async () => {
    mocks.check.mockResolvedValue({ status: 'update_available', currentVersion: '1.14.0', latestVersion: '1.15.0' });
    expect(await checkUpdateAvailable('1.14.0')).toBe(true);
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'updateAvailable',
      dedupeKey: 'updateAvailable:1.15.0',
      url: '/settings/status',
      body: 'Helprr 1.15.0 is out (this server runs 1.14.0).',
    }), expect.anything());
  });

  it('does not announce the same version again after its history row is gone', async () => {
    mocks.check.mockResolvedValue({ status: 'update_available', currentVersion: '1.14.0', latestVersion: '1.15.0' });
    await checkUpdateAvailable('1.14.0');
    await checkUpdateAvailable('1.14.0');
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    mocks.check.mockResolvedValue({ status: 'update_available', currentVersion: '1.14.0', latestVersion: '1.16.0' });
    await checkUpdateAvailable('1.14.0');
    expect(mocks.notify).toHaveBeenCalledTimes(2);
  });

  it('tries again next time when the send could not be recorded', async () => {
    mocks.check.mockResolvedValue({ status: 'update_available', currentVersion: '1.14.0', latestVersion: '1.15.0' });
    mocks.notify.mockResolvedValueOnce(null);
    await checkUpdateAvailable('1.14.0');
    await checkUpdateAvailable('1.14.0');
    expect(mocks.notify).toHaveBeenCalledTimes(2);
  });

  it('sends nothing when up to date or on a development build', async () => {
    mocks.check.mockResolvedValue({ status: 'up_to_date', currentVersion: '1.15.0', latestVersion: '1.15.0' });
    expect(await checkUpdateAvailable('1.15.0')).toBe(true);
    mocks.check.mockResolvedValue({ status: 'development', currentVersion: 'dev', latestVersion: null });
    expect(await checkUpdateAvailable('dev')).toBe(true);
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('reports a failed check so the caller retries sooner', async () => {
    mocks.check.mockResolvedValue({ status: 'unavailable', currentVersion: '1.14.0', latestVersion: null });
    expect(await checkUpdateAvailable('1.14.0')).toBe(false);
    expect(mocks.notify).not.toHaveBeenCalled();
  });
});
