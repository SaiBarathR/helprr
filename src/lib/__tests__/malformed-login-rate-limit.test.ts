import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRedisClient: vi.fn(),
  get: vi.fn(),
  pTTL: vi.fn(),
  eval: vi.fn(),
  set: vi.fn(),
}));

vi.mock('@/lib/redis', () => ({
  getRedisClient: mocks.getRedisClient,
}));

import {
  enforceLoginWritable,
  enforceMalformedLoginBackstop,
  recordGlobalLoginFailure,
  recordMalformedLoginRequest,
  recordUsernameFailure,
} from '@/lib/login-rate-limit';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRedisClient.mockResolvedValue({
    get: mocks.get,
    pTTL: mocks.pTTL,
    eval: mocks.eval,
    set: mocks.set,
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

describe('failed-attempt recorders', () => {
  it('report whether Redis took the write, so a refused one is not an ordinary wrong attempt', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.eval.mockResolvedValue('0');
    await expect(recordUsernameFailure('member', 'wrong')).resolves.toBe(true);
    await expect(recordGlobalLoginFailure()).resolves.toBe(true);

    // Redis at its memory cap with noeviction: reads still work, writes are refused.
    mocks.eval.mockRejectedValue(new Error("OOM command not allowed when used memory > 'maxmemory'."));
    await expect(recordUsernameFailure('member', 'wrong')).resolves.toBe(false);
    await expect(recordGlobalLoginFailure()).resolves.toBe(false);
  });
});

describe('write check before a credential is checked', () => {
  it('passes while Redis takes writes, and answers 503 once it refuses them', async () => {
    mocks.set.mockResolvedValue('OK');
    await expect(enforceLoginWritable()).resolves.toBeNull();
    expect(mocks.set).toHaveBeenCalledWith('login:write-check', '1', { PX: 60_000 });

    mocks.set.mockRejectedValue(new Error("OOM command not allowed when used memory > 'maxmemory'."));
    const response = await enforceLoginWritable();
    expect(response?.status).toBe(503);
    expect(await response?.json()).toEqual({ error: 'Login service unavailable' });
  });
});
