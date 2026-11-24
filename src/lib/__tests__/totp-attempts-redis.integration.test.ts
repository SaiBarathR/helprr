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
    expect(await totp.claimMfaPendingToken(token)).toEqual(expect.any(String));
    expect(await totp.startMfaAttempt(uid, 'totp', token)).toEqual({ ok: false, reason: 'used' });
    expect(await client.get(`login:mfa-account:${uid}`)).toBeNull();
  });

  it('a stalled request gives back only its own claim, never a newer one', async () => {
    const token = claims('stalled');
    const key = `login:mfa-used:${token.jti}`;
    const first = await totp.claimMfaPendingToken(token);
    expect(first).toEqual(expect.any(String));
    // The first request stalls; its claim lapses and a second request claims the token.
    await client.del(key);
    const second = await totp.claimMfaPendingToken(token);
    expect(second).toEqual(expect.any(String));
    expect(second).not.toBe(first);
    // The first request's release must not free the second's claim.
    await totp.releaseMfaPendingToken(token, first as string);
    expect(await client.get(key)).toBe(second);
    expect(await totp.claimMfaPendingToken(token)).toBeNull();
    // The claim's owner can give it back.
    await totp.releaseMfaPendingToken(token, second as string);
    expect(await client.get(key)).toBeNull();
  });

  it('an expired token claims nothing', async () => {
    const token = { ...claims('expired'), expiresAtMs: Date.now() - 1 };
    expect(await totp.claimMfaPendingToken(token)).toBeNull();
    expect(await client.get(`login:mfa-used:${token.jti}`)).toBeNull();
  });

  it('a claim that reaches Redis after the token ended claims nothing, even if the app saw it in time', async () => {
    const token = { ...claims('late'), expiresAtMs: Date.now() + 50 };
    const seenAt = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 120));
    // The app checked before the end (seenAt); Redis's own clock refuses the claim.
    expect(await totp.claimMfaPendingToken(token, seenAt)).toBeNull();
    expect(await client.get(`login:mfa-used:${token.jti}`)).toBeNull();
  });

  it('a claim lasts until a second after the token ends', async () => {
    const token = claims('pxat');
    expect(await totp.claimMfaPendingToken(token)).toEqual(expect.any(String));
    const expiresAt = await client.sendCommand(['PEXPIRETIME', `login:mfa-used:${token.jti}`]);
    expect(Number(expiresAt)).toBe(token.expiresAtMs + 1_000);
  });
});
