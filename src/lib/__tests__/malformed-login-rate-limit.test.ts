import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRedisClient: vi.fn(),
  get: vi.fn(),
  pTTL: vi.fn(),
  eval: vi.fn(),
}));

vi.mock('@/lib/redis', () => ({
  getRedisClient: mocks.getRedisClient,
}));

import {
  enforceMalformedLoginBackstop,
  recordMalformedLoginRequest,
} from '@/lib/login-rate-limit';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRedisClient.mockResolvedValue({
    get: mocks.get,
    pTTL: mocks.pTTL,
    eval: mocks.eval,
  });
  mocks.get.mockResolvedValue(null);
  mocks.pTTL.mockResolvedValue(-2);
  mocks.eval.mockResolvedValue(['1', '60000']);
});

describe('malformed-login global backstop', () => {
  it('allows requests below the ceiling and blocks at the active ceiling', async () => {
    await expect(enforceMalformedLoginBackstop()).resolves.toBeNull();

    mocks.get.mockResolvedValue('120');
    mocks.pTTL.mockResolvedValue(12_345);
    const response = await enforceMalformedLoginBackstop();

    expect(response?.status).toBe(429);
    expect(response?.headers.get('retry-after')).toBe('13');
  });

  it('atomically blocks a concurrent request that crosses the ceiling', async () => {
    mocks.eval.mockResolvedValue(['121', '54321']);

    const response = await recordMalformedLoginRequest();

    expect(response?.status).toBe(429);
    expect(response?.headers.get('retry-after')).toBe('55');
    expect(mocks.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('INCR', KEYS[1])"),
      {
        keys: ['login:malformed:global'],
        arguments: ['60000'],
      },
    );
  });

  it('fails closed when Redis is unavailable or returns an invalid counter', async () => {
    mocks.getRedisClient.mockRejectedValueOnce(new Error('Redis unavailable'));
    await expect(enforceMalformedLoginBackstop()).resolves.toMatchObject({
      status: 503,
    });

    mocks.eval.mockResolvedValueOnce('unexpected');
    await expect(recordMalformedLoginRequest()).resolves.toMatchObject({
      status: 503,
    });
  });
});
