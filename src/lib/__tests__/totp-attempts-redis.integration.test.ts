import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient, type RedisClientType } from 'redis';

// The two-step code caps against a real Redis, so the Lua script itself runs:
//   TOTP_TEST_REDIS_URL=redis://:<password>@127.0.0.1:<port> npx vitest run totp-attempts-redis
// Use a disposable Redis. Keys are unique to the run and deleted afterwards.
const redisUrl = process.env.TOTP_TEST_REDIS_URL;
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/redis', () => ({ getRedisClient: async () => holder.client }));

describe.skipIf(!redisUrl)('two-step code caps with real Redis Lua', () => {
  let client: RedisClientType;
  let totp: typeof import('@/lib/totp');
  const run = `it-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const claims = (jti: string) => ({
    userId: `${run}-user`, method: 'password' as const, stamp: 's', jti: `${run}-${jti}`, expiresAtMs: Date.now() + 300_000,
  });

  beforeAll(async () => {
    client = createClient({ url: redisUrl });
    await client.connect();
    holder.client = client;
    totp = await import('@/lib/totp');
  });

  afterAll(async () => {
    if (!client) return;
    const keys = await client.keys(`login:mfa-*${run}*`);
    if (keys.length) await client.del(keys);
    await client.quit();
  });

  it('a recovery code skips the hourly account cap but keeps the per-token cap', async () => {
    const uid = `${run}-user`;
    // Ten authenticator codes over two tokens use up the account's hour.
    for (let i = 0; i < 10; i++) {
      expect(await totp.startMfaAttempt(uid, 'totp', claims(`t${Math.floor(i / 5)}`))).toEqual({ ok: true });
    }
    expect(await totp.startMfaAttempt(uid, 'totp', claims('t2'))).toMatchObject({ ok: false, reason: 'locked' });

    // A recovery code still gets its five tries on a fresh token, then the token is spent.
    const token = claims('r');
    for (let i = 0; i < 5; i++) expect(await totp.startMfaAttempt(uid, 'recovery-code', token)).toEqual({ ok: true });
    expect(await totp.startMfaAttempt(uid, 'recovery-code', token)).toEqual({ ok: false, reason: 'spent' });
    // And it never touched the account count.
    expect(await client.get(`login:mfa-account:${uid}`)).toBe('11');
  });

  it('a used token answers "used" before anything is counted', async () => {
    const uid = `${run}-used`;
    const token = claims('used');
    expect(await totp.claimMfaPendingToken(token)).toBe(true);
    expect(await totp.startMfaAttempt(uid, 'totp', token)).toEqual({ ok: false, reason: 'used' });
    expect(await client.get(`login:mfa-account:${uid}`)).toBeNull();
  });
});
