import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  pruneOrphanImageCache,
  type ImageCacheRetentionOptions,
} from '@/lib/cache/image-cache-retention';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_MS = Date.UTC(2026, 6, 14, 12);
const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

type RetentionRedis = NonNullable<ImageCacheRetentionOptions['redis']>;

class FakeRedis implements RetentionRedis {
  readonly values = new Map<string, string>();
  readonly hashes = new Map<string, Record<string, string>>();
  scans = 0;
  beforeScan?: (scanNumber: number) => void;
  afterSet?: (key: string) => void;
  loseQuotaLockOnReconcile = false;
  changeGenerationOnReconcile = false;

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
    this.afterSet?.(key);
    return 'OK';
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    return { ...(this.hashes.get(key) ?? {}) };
  }

  async eval(
    script: string,
    options: { keys: string[]; arguments: string[] },
  ): Promise<unknown> {
    if (script.includes('image-cache-release-lock-v1')) {
      if (this.values.get(options.keys[0]) === options.arguments[0]) {
        this.values.delete(options.keys[0]);
        return 1;
      }
      return 0;
    }
    if (script.includes('image-cache-renew-maintenance-lock-v1')) {
      return this.values.get(options.keys[0]) === options.arguments[0] ? 1 : 0;
    }
    if (script.includes('image-cache-reconcile-v1')) {
      const lockKey = options.keys[4];
      const lockToken = options.arguments[4];
      if (
        this.loseQuotaLockOnReconcile
        || this.values.get(lockKey) !== lockToken
      ) {
        return ['LOCK_LOST'];
      }
      if (this.changeGenerationOnReconcile) {
        this.values.set('helprr:cache:generation', '2');
      }
      if (this.values.get(options.keys[5]) !== options.arguments[6]) {
        return ['GENERATION_CHANGED'];
      }
      const entries = JSON.parse(options.arguments[0]) as Array<{
        entryKey: string;
        relativePath: string;
        sizeBytes: number;
        lastUsedAt: number;
      }>;
      const deleteKeys = JSON.parse(options.arguments[1]) as string[];
      for (const key of deleteKeys) this.values.delete(key);
      this.hashes.set(
        options.keys[0],
        Object.fromEntries(entries.map((entry) => [entry.entryKey, JSON.stringify(entry)])),
      );
      this.hashes.set(options.keys[2], {
        bytes: String(entries.reduce((total, entry) => total + entry.sizeBytes, 0)),
        entries: String(entries.length),
      });
      return [
        'OK',
        String(entries.reduce((total, entry) => total + entry.sizeBytes, 0)),
        String(entries.length),
      ];
    }
    if (script.includes('image-cache-delete-generation-v1')) {
      const metadataKeys = JSON.parse(options.arguments[0]) as string[];
      for (const key of metadataKeys) this.values.delete(key);
      for (const key of options.keys) this.hashes.delete(key);
      return metadataKeys.length;
    }
    throw new Error('Unexpected fake Redis script');
  }

  async scan(
    _cursor: string,
    options: { MATCH: string; COUNT: number },
  ): Promise<{ cursor: string; keys: string[] }> {
    this.scans += 1;
    this.beforeScan?.(this.scans);
    const prefix = options.MATCH.slice(0, -1);
    return {
      cursor: '0',
      keys: [...this.values.keys()].filter((key) => key.startsWith(prefix)),
    };
  }
}

const roots: string[] = [];

function fixtureRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'helprr-image-retention-'));
  roots.push(root);
  return root;
}

function age(filePath: string, ageMs: number): void {
  const when = new Date(NOW_MS - ageMs);
  utimesSync(filePath, when, when);
}

function metadata(
  generation: number,
  relativePath: string,
  sizeBytes: number,
  fetchedAt = NOW_MS - 2 * DAY_MS,
): string {
  return JSON.stringify({
    generation,
    relativePath,
    contentType: 'image/webp',
    format: 'webp',
    sizeBytes,
    fetchedAt,
    expiresAt: NOW_MS - DAY_MS,
    staleUntil: NOW_MS + DAY_MS,
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('pruneOrphanImageCache', () => {
  it('removes only aged unreferenced files and abandoned generations', async () => {
    const root = fixtureRoot();
    const active = path.join(root, 'v3');
    const abandoned = path.join(root, 'v2');
    mkdirSync(active);
    mkdirSync(abandoned);

    const referencedName = `${HASH_A}-${UUID_A}.bin`;
    const orphanName = `${HASH_B}-${UUID_B}.bin`;
    const legacyOrphanName = `${HASH_C}.bin`;
    const freshName = `${'d'.repeat(64)}-${UUID_A}.bin`;
    const tempName = `${'e'.repeat(64)}-${UUID_A}.bin.tmp-${UUID_B}`;
    const unknownName = 'keep-me.txt';
    for (const name of [referencedName, orphanName, legacyOrphanName, freshName, tempName, unknownName]) {
      writeFileSync(path.join(active, name), name);
    }
    for (const name of [referencedName, orphanName, legacyOrphanName, tempName]) {
      age(path.join(active, name), 2 * DAY_MS);
    }

    const abandonedFile = path.join(abandoned, 'old.bin');
    writeFileSync(abandonedFile, 'abandoned');
    age(abandonedFile, 2 * DAY_MS);
    age(abandoned, 2 * DAY_MS);

    const outside = path.join(root, 'outside.txt');
    writeFileSync(outside, 'outside');
    const symlink = path.join(active, `${'f'.repeat(64)}.bin`);
    symlinkSync(outside, symlink);

    const redis = new FakeRedis();
    redis.values.set('helprr:cache:generation', '3');
    redis.values.set(
      `helprr:cache:image:v3:${HASH_A}`,
      metadata(3, path.join('v3', referencedName), Buffer.byteLength(referencedName)),
    );

    const result = await pruneOrphanImageCache({ rootDir: root, nowMs: NOW_MS, redis });

    expect(result).toMatchObject({
      status: 'completed',
      generation: 3,
      metadataEntries: 1,
      deletedFiles: 4,
      deletedGenerations: 1,
    });
    expect(existsSync(path.join(active, referencedName))).toBe(true);
    expect(existsSync(path.join(active, orphanName))).toBe(false);
    expect(existsSync(path.join(active, legacyOrphanName))).toBe(false);
    expect(existsSync(path.join(active, freshName))).toBe(true);
    expect(existsSync(path.join(active, tempName))).toBe(false);
    expect(existsSync(path.join(active, unknownName))).toBe(true);
    expect(existsSync(symlink)).toBe(true);
    expect(existsSync(outside)).toBe(true);
    expect(existsSync(abandoned)).toBe(false);
  });

  it('unions metadata from a second scan before deleting candidates', async () => {
    const root = fixtureRoot();
    const active = path.join(root, 'v1');
    mkdirSync(active);
    const fileName = `${HASH_A}-${UUID_A}.bin`;
    const filePath = path.join(active, fileName);
    writeFileSync(filePath, 'keep');
    age(filePath, 2 * DAY_MS);

    const redis = new FakeRedis();
    redis.values.set('helprr:cache:generation', '1');
    redis.beforeScan = (scanNumber) => {
      if (scanNumber === 2) {
        redis.values.set(
          `helprr:cache:image:v1:${HASH_A}`,
          metadata(1, path.join('v1', fileName), Buffer.byteLength('keep')),
        );
      }
    };

    const result = await pruneOrphanImageCache({ rootDir: root, nowMs: NOW_MS, redis });

    expect(result.deletedFiles).toBe(0);
    expect(existsSync(filePath)).toBe(true);
  });

  it('includes a cache fill committed immediately before the quota lock is acquired', async () => {
    const root = fixtureRoot();
    const active = path.join(root, 'v1');
    mkdirSync(active);
    const fileName = `${HASH_A}-${UUID_A}.bin`;
    const filePath = path.join(active, fileName);
    writeFileSync(filePath, 'keep');
    age(filePath, 2 * DAY_MS);

    const redis = new FakeRedis();
    redis.values.set('helprr:cache:generation', '1');
    redis.afterSet = (key) => {
      if (key === 'helprr:cache:lock:image-quota:v1') {
        redis.values.set(
          `helprr:cache:image:v1:${HASH_A}`,
          metadata(1, path.join('v1', fileName), Buffer.byteLength('keep')),
        );
      }
    };

    const result = await pruneOrphanImageCache({ rootDir: root, nowMs: NOW_MS, redis });

    expect(result).toMatchObject({
      status: 'completed',
      metadataEntries: 1,
      reconciledEntries: 1,
      deletedFiles: 0,
    });
    expect(existsSync(filePath)).toBe(true);
  });

  it('skips every mutation when the cache generation changes during the scan', async () => {
    const root = fixtureRoot();
    const active = path.join(root, 'v1');
    mkdirSync(active);
    const filePath = path.join(active, `${HASH_A}.bin`);
    writeFileSync(filePath, 'keep');
    age(filePath, 2 * DAY_MS);

    const redis = new FakeRedis();
    redis.values.set('helprr:cache:generation', '1');
    redis.beforeScan = (scanNumber) => {
      if (scanNumber === 2) redis.values.set('helprr:cache:generation', '2');
    };

    const result = await pruneOrphanImageCache({ rootDir: root, nowMs: NOW_MS, redis });

    expect(result).toMatchObject({ status: 'skipped', reason: 'generation-changed' });
    expect(existsSync(filePath)).toBe(true);
  });

  it('fails closed when Redis metadata cannot be scanned', async () => {
    const root = fixtureRoot();
    const active = path.join(root, 'v1');
    mkdirSync(active);
    const filePath = path.join(active, `${HASH_A}.bin`);
    writeFileSync(filePath, 'keep');
    age(filePath, 2 * DAY_MS);

    const redis = new FakeRedis();
    redis.values.set('helprr:cache:generation', '1');
    redis.scan = async () => { throw new Error('Redis unavailable'); };

    await expect(pruneOrphanImageCache({ rootDir: root, nowMs: NOW_MS, redis }))
      .rejects.toThrow('Redis unavailable');
    expect(existsSync(filePath)).toBe(true);
  });

  it('skips cleanup while an admin cache purge is active', async () => {
    const root = fixtureRoot();
    const active = path.join(root, 'v1');
    mkdirSync(active);
    const filePath = path.join(active, `${HASH_A}.bin`);
    writeFileSync(filePath, 'keep');
    age(filePath, 2 * DAY_MS);

    const redis = new FakeRedis();
    redis.values.set('helprr:cache:generation', '1');
    redis.values.set('helprr:cache:purge:status', 'purging');

    const result = await pruneOrphanImageCache({ rootDir: root, nowMs: NOW_MS, redis });

    expect(result).toMatchObject({ status: 'skipped', reason: 'purge-in-progress' });
    expect(existsSync(filePath)).toBe(true);
  });

  it('rebuilds the quota index and evicts least-recently-used metadata before files', async () => {
    const root = fixtureRoot();
    const active = path.join(root, 'v1');
    mkdirSync(active);
    const fixtures = [
      { hash: HASH_A, uuid: UUID_A, body: 'aaaa', usedAt: NOW_MS - 3_000 },
      { hash: HASH_B, uuid: UUID_B, body: 'bbbb', usedAt: NOW_MS - 2_000 },
      { hash: HASH_C, uuid: UUID_A, body: 'cccc', usedAt: NOW_MS - 1_000 },
    ];
    const redis = new FakeRedis();
    redis.values.set('helprr:cache:generation', '1');
    const indexed: Record<string, string> = {};

    for (const item of fixtures) {
      const fileName = `${item.hash}-${item.uuid}.bin`;
      const relativePath = path.join('v1', fileName);
      writeFileSync(path.join(active, fileName), item.body);
      const entryKey = `helprr:cache:image:v1:${item.hash}`;
      redis.values.set(
        entryKey,
        metadata(1, relativePath, Buffer.byteLength(item.body), item.usedAt),
      );
      indexed[entryKey] = JSON.stringify({
        entryKey,
        relativePath,
        sizeBytes: Buffer.byteLength(item.body),
        lastUsedAt: item.usedAt,
      });
    }
    redis.hashes.set('helprr:cache:image-index:v1', indexed);

    const result = await pruneOrphanImageCache({
      rootDir: root,
      nowMs: NOW_MS,
      redis,
      maxBytes: 8,
      maxEntries: 2,
    });

    expect(result).toMatchObject({
      status: 'completed',
      reconciledEntries: 2,
      quotaBytes: 8,
      quotaEntries: 2,
      evictedEntries: 1,
    });
    expect(redis.values.has(`helprr:cache:image:v1:${HASH_A}`)).toBe(false);
    expect(existsSync(path.join(active, `${HASH_A}-${UUID_A}.bin`))).toBe(false);
    expect(existsSync(path.join(active, `${HASH_B}-${UUID_B}.bin`))).toBe(true);
    expect(existsSync(path.join(active, `${HASH_C}-${UUID_A}.bin`))).toBe(true);
    expect(Object.keys(redis.hashes.get('helprr:cache:image-index:v1') ?? {}))
      .toHaveLength(2);
  });

  it('does not mutate files or accounting while another quota mutation holds the lock', async () => {
    const root = fixtureRoot();
    const active = path.join(root, 'v1');
    mkdirSync(active);
    const filePath = path.join(active, `${HASH_A}.bin`);
    writeFileSync(filePath, 'orphan');
    age(filePath, 2 * DAY_MS);

    const redis = new FakeRedis();
    redis.values.set('helprr:cache:generation', '1');
    redis.values.set('helprr:cache:lock:image-quota:v1', 'writer-token');

    const result = await pruneOrphanImageCache({ rootDir: root, nowMs: NOW_MS, redis });

    expect(result).toMatchObject({ status: 'skipped', reason: 'quota-lock-busy' });
    expect(existsSync(filePath)).toBe(true);
  });

  it('does not mutate metadata or files after losing the quota lock', async () => {
    const root = fixtureRoot();
    const active = path.join(root, 'v1');
    mkdirSync(active);
    const filePath = path.join(active, `${HASH_A}.bin`);
    writeFileSync(filePath, 'orphan');
    age(filePath, 2 * DAY_MS);

    const redis = new FakeRedis();
    redis.values.set('helprr:cache:generation', '1');
    redis.values.set(
      `helprr:cache:image:v1:${HASH_B}`,
      metadata(1, path.join('v1', `${HASH_B}.bin`), 4),
    );
    redis.loseQuotaLockOnReconcile = true;

    const result = await pruneOrphanImageCache({ rootDir: root, nowMs: NOW_MS, redis });

    expect(result).toMatchObject({ status: 'skipped', reason: 'quota-lock-lost' });
    expect(existsSync(filePath)).toBe(true);
    expect(redis.values.has(`helprr:cache:image:v1:${HASH_B}`)).toBe(true);
    expect(redis.hashes.has('helprr:cache:image-index:v1')).toBe(false);
  });

  it('does not recreate accounting after the active generation changes', async () => {
    const root = fixtureRoot();
    const active = path.join(root, 'v1');
    mkdirSync(active);
    const filePath = path.join(active, `${HASH_A}.bin`);
    writeFileSync(filePath, 'orphan');
    age(filePath, 2 * DAY_MS);

    const redis = new FakeRedis();
    redis.values.set('helprr:cache:generation', '1');
    redis.values.set(
      `helprr:cache:image:v1:${HASH_B}`,
      metadata(1, path.join('v1', `${HASH_B}.bin`), 4),
    );
    redis.changeGenerationOnReconcile = true;

    const result = await pruneOrphanImageCache({ rootDir: root, nowMs: NOW_MS, redis });

    expect(result).toMatchObject({ status: 'skipped', reason: 'generation-changed' });
    expect(existsSync(filePath)).toBe(true);
    expect(redis.values.has(`helprr:cache:image:v1:${HASH_B}`)).toBe(true);
    expect(redis.hashes.has('helprr:cache:image-index:v1')).toBe(false);
  });
});
