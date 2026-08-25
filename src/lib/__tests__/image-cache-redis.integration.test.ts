import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type RedisClientType } from 'redis';
import type { ImageAccountingRedis } from '@/lib/cache/image-cache-accounting';

const redisUrl = process.env.IMAGE_CACHE_TEST_REDIS_URL;

describe.skipIf(!redisUrl)('image cache accounting with real Redis Lua', () => {
  let client: RedisClientType;
  let accounting: typeof import('@/lib/cache/image-cache-accounting');

  beforeAll(async () => {
    client = createClient({ url: redisUrl });
    await client.connect();
    await client.flushDb();
    accounting = await import('@/lib/cache/image-cache-accounting');
  });

  afterAll(async () => {
    if (!client) return;
    await client.flushDb();
    await client.quit();
  });

  function redis(): ImageAccountingRedis {
    return client as unknown as ImageAccountingRedis;
  }

  it('preserves an empty Lua eviction list as an array during registration', async () => {
    await client.set('helprr:cache:generation', '7');
    const token = await accounting.acquireImageQuotaLock(redis(), 7);
    expect(token).toBeTruthy();
    const entryKey = `helprr:cache:image:v7:${'a'.repeat(64)}`;
    const mutation = await accounting.registerImageCacheEntry(
      redis(),
      7,
      {
        entryKey,
        relativePath: `v7/${'a'.repeat(64)}-11111111-1111-4111-8111-111111111111.bin`,
        sizeBytes: 4,
        lastUsedAt: 1,
      },
      JSON.stringify({ generation: 7 }),
      60,
      token!,
    );
    await accounting.releaseImageQuotaLock(redis(), 7, token!);

    expect(mutation).toMatchObject({ previous: null, evicted: [], bytes: 4, entries: 1 });
  });

  it('enforces and releases cross-replica processing leases', async () => {
    const leases = await Promise.all(Array.from({ length: 6 }, () => (
      accounting.acquireImageProcessingLease(redis(), 'same-user')
    )));
    expect(leases.filter(Boolean)).toHaveLength(5);
    for (const lease of leases) {
      if (lease) await accounting.releaseImageProcessingLease(redis(), lease);
    }
    await expect(accounting.acquireImageProcessingLease(redis(), 'same-user'))
      .resolves.toBeTruthy();
  });

  it('uses a burstable token bucket while bounding sustained starts', async () => {
    const burst = Number(process.env.IMAGE_FETCH_RATE_BURST ?? 600);
    const outcomes = [];
    for (let index = 0; index < burst + 1; index += 1) {
      outcomes.push(await accounting.enforceImageFetchRateLimit(redis(), 'rate-user'));
    }
    expect(outcomes.slice(0, burst).every((outcome) => outcome.allowed)).toBe(true);
    expect(outcomes[burst]).toMatchObject({ allowed: false });
    expect(outcomes[burst]!.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('uses token-checked locks and rejects a generation-changed registration', async () => {
    const fill = await accounting.acquireImageFillLock(redis(), 7, 'b'.repeat(64));
    expect(fill).toBeTruthy();
    await expect(accounting.renewImageFillLock(redis(), 7, 'b'.repeat(64), fill!))
      .resolves.toBe(true);
    await client.set(`helprr:cache:lock:image-fill:v7:${'b'.repeat(64)}`, 'new-owner');
    await expect(accounting.renewImageFillLock(redis(), 7, 'b'.repeat(64), fill!))
      .resolves.toBe(false);
    await accounting.releaseImageFillLock(redis(), 7, 'b'.repeat(64), fill!);
    expect(await client.get(`helprr:cache:lock:image-fill:v7:${'b'.repeat(64)}`))
      .toBe('new-owner');

    const quota = await accounting.acquireImageQuotaLock(redis(), 7);
    expect(quota).toBeTruthy();
    await client.set('helprr:cache:generation', '8');
    await expect(accounting.registerImageCacheEntry(
      redis(),
      7,
      {
        entryKey: `helprr:cache:image:v7:${'c'.repeat(64)}`,
        relativePath: `v7/${'c'.repeat(64)}-22222222-2222-4222-8222-222222222222.bin`,
        sizeBytes: 4,
        lastUsedAt: 2,
      },
      JSON.stringify({ generation: 7 }),
      60,
      quota!,
    )).rejects.toBeInstanceOf(accounting.ImageCacheGenerationChangedError);
    await accounting.releaseImageQuotaLock(redis(), 7, quota!);
  });

  it('recovers a crashed fill owner after the configured short lease', async () => {
    const keyHash = 'd'.repeat(64);
    await client.set('helprr:cache:generation', '7');
    await expect(accounting.acquireImageFillLock(redis(), 7, keyHash)).resolves.toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 80));
    await expect(accounting.acquireImageFillLock(redis(), 7, keyHash)).resolves.toBeTruthy();
  });
});
