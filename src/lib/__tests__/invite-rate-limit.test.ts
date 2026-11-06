import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRedisClient: vi.fn(),
  get: vi.fn(),
  pTTL: vi.fn(),
  eval: vi.fn(),
}));

vi.mock('@/lib/redis', () => ({ getRedisClient: mocks.getRedisClient }));

import {
  enforceInviteFailureBackstop,
  enforceInviteRateLimit,
  recordInviteFailure,
} from '@/lib/invite-rate-limit';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRedisClient.mockResolvedValue({ get: mocks.get, pTTL: mocks.pTTL, eval: mocks.eval });
  mocks.get.mockResolvedValue(null);
  mocks.pTTL.mockResolvedValue(-2);
  mocks.eval.mockResolvedValue(['1', '60000']);
});

describe('invite throttles', () => {
  it('count failures under their own key, never the sign-in ones', async () => {
    await recordInviteFailure();
    expect(mocks.eval).toHaveBeenCalledWith(expect.stringContaining("redis.call('INCR', KEYS[1])"), {
      keys: ['invite:failures:global'],
      arguments: [String(15 * 60_000)],
    });
    await enforceInviteRateLimit('203.0.113.7');
    expect(mocks.eval).toHaveBeenLastCalledWith(expect.any(String), {
      keys: ['invite:attempts:203.0.113.7'],
      arguments: ['60000'],
    });
    const keys = [
      ...mocks.eval.mock.calls.flatMap(([, options]) => options.keys),
      ...mocks.get.mock.calls.map(([key]) => key),
    ];
    expect(keys.some((key: string) => key.startsWith('login:'))).toBe(false);
  });

  it('refuse at the failure cap, read-only, with the time left', async () => {
    await expect(enforceInviteFailureBackstop()).resolves.toBeNull();
    mocks.get.mockResolvedValue('30');
    mocks.pTTL.mockResolvedValue(125_000);
    const response = await enforceInviteFailureBackstop();
    expect(response?.status).toBe(429);
    expect(response?.headers.get('retry-after')).toBe('125');
    await expect(response?.json()).resolves.toEqual({ error: 'Too many attempts. Try again in 3 minutes.' });
    expect(mocks.get).toHaveBeenCalledWith('invite:failures:global');
    expect(mocks.eval).not.toHaveBeenCalled();
  });

  it('allow ten requests a minute per client IP, and skip the bucket with no trusted IP', async () => {
    mocks.eval.mockResolvedValue(['10', '30000']);
    await expect(enforceInviteRateLimit('203.0.113.7')).resolves.toBeNull();
    mocks.eval.mockResolvedValue(['11', '30000']);
    expect((await enforceInviteRateLimit('203.0.113.7'))?.status).toBe(429);
    mocks.eval.mockClear();
    await expect(enforceInviteRateLimit(undefined)).resolves.toBeNull();
    expect(mocks.eval).not.toHaveBeenCalled();
  });

  it('fail closed when Redis is down, and only log a failed count', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.getRedisClient.mockRejectedValue(new Error('Redis unavailable'));
    expect((await enforceInviteFailureBackstop())?.status).toBe(503);
    expect((await enforceInviteRateLimit('203.0.113.7'))?.status).toBe(503);
    await expect(recordInviteFailure()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
  });
});
