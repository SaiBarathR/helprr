import { afterEach, describe, expect, it, vi } from 'vitest';

class AccountingRedis {
  readonly values = new Map<string, string>();
  readonly hashes = new Map<string, Record<string, string>>();
  readonly lru = new Map<string, Map<string, number>>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(
    key: string,
    value: string,
    options?: { NX?: boolean; PX?: number },
  ): Promise<string | null> {
    if (options?.NX && this.values.has(key)) return null;
    this.values.set(key, value);
    return 'OK';
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    return { ...(this.hashes.get(key) ?? {}) };
  }

  // This reimplements each Lua script in JavaScript, so it exercises the
  // accounting contract but NOT real Lua/cjson semantics. Anything that depends
  // on how Redis serializes a Lua value needs its own explicit test — see
  // "tolerates cjson encoding an empty eviction list as an object".
  async eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown> {
    if (script.includes('image-cache-register-v3')) {
      const [metaKey, indexKey, lruKey, usageKey] = options.keys;
      if (this.values.get(options.keys[4]) !== options.arguments[6]) {
        return ['GENERATION_CHANGED'];
      }
      if (this.values.get(options.keys[5]) !== options.arguments[7]) {
        return ['LOCK_LOST'];
      }
      const entryKey = options.arguments[0];
      const index = { ...(this.hashes.get(indexKey) ?? {}) };
      const previous = index[entryKey] ?? '';
      const previousSize = previous
        ? (JSON.parse(previous).sizeBytes as number)
        : 0;
      const entry = JSON.parse(options.arguments[3]) as {
        sizeBytes: number;
        lastUsedAt: number;
      };
      this.values.set(metaKey, options.arguments[1]);
      index[entryKey] = options.arguments[3];
      this.hashes.set(indexKey, index);
      const scores = new Map(this.lru.get(lruKey) ?? []);
      scores.set(entryKey, entry.lastUsedAt);
      this.lru.set(lruKey, scores);
      const usage = { ...(this.hashes.get(usageKey) ?? {}) };
      let bytes = Number(usage.bytes ?? 0) - previousSize + entry.sizeBytes;
      let entries = Number(usage.entries ?? 0) + (previous ? 0 : 1);
      const maxBytes = Number(options.arguments[9]);
      const maxEntries = Number(options.arguments[10]);
      const evicted: string[] = [];
      while (bytes > maxBytes || entries > maxEntries) {
        const oldest = [...scores.entries()].sort((left, right) => (
          left[1] - right[1] || left[0].localeCompare(right[0])
        ))[0];
        if (!oldest) break;
        const raw = index[oldest[0]] ?? '';
        const size = raw ? (JSON.parse(raw).sizeBytes as number) : 0;
        if (raw) evicted.push(raw);
        delete index[oldest[0]];
        scores.delete(oldest[0]);
        this.values.delete(oldest[0]);
        bytes = Math.max(0, bytes - size);
        entries = Math.max(0, entries - 1);
      }
      this.hashes.set(indexKey, index);
      this.hashes.set(usageKey, { bytes: String(bytes), entries: String(entries) });
      return [previous, JSON.stringify(evicted), String(bytes), String(entries)];
    }
    if (script.includes('image-cache-remove-v1')) {
      const [indexKey, lruKey, usageKey] = options.keys;
      const entryKey = options.arguments[0];
      const expectedRelativePath = options.arguments[1];
      const index = { ...(this.hashes.get(indexKey) ?? {}) };
      const raw = index[entryKey] ?? '';
      if (raw) {
        const current = JSON.parse(raw) as { relativePath: string; sizeBytes: number };
        if (
          expectedRelativePath
          && current.relativePath !== expectedRelativePath
        ) {
          return '';
        }
        delete index[entryKey];
        this.hashes.set(indexKey, index);
        this.lru.get(lruKey)?.delete(entryKey);
        this.values.delete(entryKey);
        const usage = { ...(this.hashes.get(usageKey) ?? {}) };
        this.hashes.set(usageKey, {
          bytes: String(Math.max(0, Number(usage.bytes ?? 0) - current.sizeBytes)),
          entries: String(Math.max(0, Number(usage.entries ?? 0) - 1)),
        });
      }
      return raw;
    }
    if (script.includes('image-cache-release-lock-v1')) {
      if (this.values.get(options.keys[0]) === options.arguments[0]) {
        this.values.delete(options.keys[0]);
        return 1;
      }
      return 0;
    }
    if (script.includes('image-cache-observe-v1')) return 1;
    throw new Error('Unexpected fake Redis script');
  }
}

async function loadAccounting() {
  process.env.IMAGE_CACHE_MAX_BYTES = '8';
  process.env.IMAGE_CACHE_MAX_ENTRIES = '2';
  vi.resetModules();
  return import('@/lib/cache/image-cache-accounting');
}

afterEach(() => {
  delete process.env.IMAGE_CACHE_MAX_BYTES;
  delete process.env.IMAGE_CACHE_MAX_ENTRIES;
});

describe('per-generation image-cache quota accounting', () => {
  it('evicts by LRU under byte and entry limits and reports safe replacement paths', async () => {
    const accounting = await loadAccounting();
    const redis = new AccountingRedis();
    const generation = 4;
    redis.values.set('helprr:cache:generation', String(generation));
    const entry = (
      suffix: string,
      relativePath: string,
      sizeBytes: number,
      lastUsedAt: number,
    ) => ({
      entryKey: `helprr:cache:image:v4:${suffix.repeat(64)}`,
      relativePath,
      sizeBytes,
      lastUsedAt,
    });
    const a = entry('a', 'v4/a.bin', 4, 1);
    const b = entry('b', 'v4/b.bin', 4, 2);
    const c = entry('c', 'v4/c.bin', 4, 3);
    const register = async (
      value: ReturnType<typeof entry>,
      metadata: string,
    ) => {
      const token = await accounting.acquireImageQuotaLock(redis, generation);
      expect(token).toBeTruthy();
      try {
        return await accounting.registerImageCacheEntry(
          redis,
          generation,
          value,
          metadata,
          60,
          token!,
        );
      } finally {
        await accounting.releaseImageQuotaLock(redis, generation, token!);
      }
    };

    await register(a, '{"a":1}');
    await register(b, '{"b":1}');
    const third = await register(c, '{"c":1}');

    expect(third).toMatchObject({
      bytes: 8,
      entries: 2,
      evicted: [a],
    });
    expect(redis.values.has(a.entryKey)).toBe(false);

    const replacement = { ...b, relativePath: 'v4/b-new.bin', sizeBytes: 3, lastUsedAt: 4 };
    const replaced = await register(replacement, '{"b":2}');
    expect(replaced).toMatchObject({
      previous: b,
      evicted: [],
      bytes: 7,
      entries: 2,
    });
  });

  // Redis' cjson cannot tell an empty Lua array from an empty Lua dict, so
  // `cjson.encode({})` yields "{}" rather than "[]". Registration must treat
  // that as "nothing was evicted"; rejecting it made every uncached image fill
  // throw, which deleted the file just written and left the cache permanently
  // empty while the quota ledger kept accruing entries.
  it('tolerates cjson encoding an empty eviction list as an object', async () => {
    const accounting = await loadAccounting();
    const generation = 4;
    const entryKey = `helprr:cache:image:v${generation}:${'a'.repeat(64)}`;
    const redis = {
      get: async () => null,
      set: async () => 'OK',
      hGetAll: async () => ({}),
      eval: async () => ['', '{}', '4', '1'],
    };

    const mutation = await accounting.registerImageCacheEntry(
      redis,
      generation,
      { entryKey, relativePath: `v${generation}/a.bin`, sizeBytes: 4, lastUsedAt: 1 },
      '{"a":1}',
      60,
      'quota-token',
    );

    expect(mutation).toMatchObject({ previous: null, evicted: [], bytes: 4, entries: 1 });
  });

  it('serializes quota writers with one narrowly scoped generation lock', async () => {
    const accounting = await loadAccounting();
    const redis = new AccountingRedis();

    const [first, second] = await Promise.all([
      accounting.acquireImageQuotaLock(redis, 1),
      accounting.acquireImageQuotaLock(redis, 1),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    const token = first ?? second;
    expect(token).toBeTruthy();
    await accounting.releaseImageQuotaLock(redis, 1, token!);
    await expect(accounting.acquireImageQuotaLock(redis, 1)).resolves.toBeTruthy();
  });

  it('does not remove a newer immutable replacement through a stale cleanup path', async () => {
    const accounting = await loadAccounting();
    const redis = new AccountingRedis();
    const generation = 1;
    redis.values.set('helprr:cache:generation', String(generation));
    const entryKey = `helprr:cache:image:v1:${'a'.repeat(64)}`;
    const original = {
      entryKey,
      relativePath: 'v1/original.bin',
      sizeBytes: 4,
      lastUsedAt: 1,
    };
    const replacement = {
      ...original,
      relativePath: 'v1/replacement.bin',
      sizeBytes: 5,
      lastUsedAt: 2,
    };
    const register = async (
      value: typeof original,
      metadata: string,
    ) => {
      const token = await accounting.acquireImageQuotaLock(redis, generation);
      expect(token).toBeTruthy();
      try {
        return await accounting.registerImageCacheEntry(
          redis,
          generation,
          value,
          metadata,
          60,
          token!,
        );
      } finally {
        await accounting.releaseImageQuotaLock(redis, generation, token!);
      }
    };

    await register(original, '{"version":1}');
    await register(replacement, '{"version":2}');

    await expect(
      accounting.removeImageCacheEntry(
        redis,
        generation,
        entryKey,
        original.relativePath,
      ),
    ).resolves.toBeNull();
    expect(redis.values.get(entryKey)).toBe('{"version":2}');
    expect(JSON.parse(
      redis.hashes.get('helprr:cache:image-index:v1')?.[entryKey] ?? '{}',
    )).toMatchObject({ relativePath: replacement.relativePath });
  });

  it('atomically rejects registration after the active generation changes', async () => {
    const accounting = await loadAccounting();
    const redis = new AccountingRedis();
    redis.values.set('helprr:cache:generation', '2');
    const entryKey = `helprr:cache:image:v1:${'c'.repeat(64)}`;
    const token = await accounting.acquireImageQuotaLock(redis, 1);
    expect(token).toBeTruthy();

    await expect(accounting.registerImageCacheEntry(
      redis,
      1,
      {
        entryKey,
        relativePath: 'v1/c.bin',
        sizeBytes: 4,
        lastUsedAt: 1,
      },
      '{"generation":1}',
      60,
      token!,
    )).rejects.toBeInstanceOf(accounting.ImageCacheGenerationChangedError);
    expect(redis.values.has(entryKey)).toBe(false);
  });

  it('atomically rejects registration by an expired quota-lock owner', async () => {
    const accounting = await loadAccounting();
    const redis = new AccountingRedis();
    redis.values.set('helprr:cache:generation', '1');
    const token = await accounting.acquireImageQuotaLock(redis, 1);
    expect(token).toBeTruthy();
    redis.values.set('helprr:cache:lock:image-quota:v1', 'new-owner');

    await expect(accounting.registerImageCacheEntry(
      redis,
      1,
      {
        entryKey: `helprr:cache:image:v1:${'d'.repeat(64)}`,
        relativePath: 'v1/d.bin',
        sizeBytes: 4,
        lastUsedAt: 1,
      },
      '{"generation":1}',
      60,
      token!,
    )).rejects.toBeInstanceOf(accounting.ImageQuotaLockLostError);
  });

  it('returns bounded, URL-free quota and rejection diagnostics', async () => {
    const accounting = await loadAccounting();
    const redis = new AccountingRedis();
    redis.hashes.set('helprr:cache:image-usage:v2', {
      bytes: '7',
      entries: '2',
    });
    redis.hashes.set('helprr:cache:image-observability', {
      evictions: '3',
      oversizedRejections: '4',
      invalidImageRejections: '5',
      upstreamFetches: '6',
      cacheHits: '7',
      cacheBypasses: '8',
      rateLimited: '9',
      lastOutcome: 'invalid-image',
      lastValidatedBytes: '512',
      lastDetectedFormat: 'png',
      lastCacheStatus: 'MISS',
      lastHost: 'images.example.com',
    });

    const diagnostics = await accounting.getImageCacheDiagnostics(redis, 2);

    expect(diagnostics).toEqual({
      accountingAvailable: true,
      quotaBytes: 7,
      quotaEntries: 2,
      maxBytes: 8,
      maxEntries: 2,
      evictions: 3,
      oversizedRejections: 4,
      invalidImageRejections: 5,
      upstreamFetches: 6,
      cacheHits: 7,
      cacheBypasses: 8,
      rateLimited: 9,
      lastOutcome: 'invalid-image',
      lastValidatedBytes: 512,
      lastDetectedFormat: 'png',
      lastCacheStatus: 'MISS',
      lastHost: 'images.example.com',
    });
    expect(JSON.stringify(diagnostics)).not.toContain('http');
  });
});
