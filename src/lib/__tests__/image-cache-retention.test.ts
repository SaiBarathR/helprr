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
  scans = 0;
  beforeScan?: (scanNumber: number) => void;

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
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

function metadata(generation: number, relativePath: string): string {
  return JSON.stringify({
    generation,
    relativePath,
    contentType: 'image/webp',
    sizeBytes: 1,
    fetchedAt: NOW_MS - 2 * DAY_MS,
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
      metadata(3, path.join('v3', referencedName)),
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
          metadata(1, path.join('v1', fileName)),
        );
      }
    };

    const result = await pruneOrphanImageCache({ rootDir: root, nowMs: NOW_MS, redis });

    expect(result.deletedFiles).toBe(0);
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

    const redis: RetentionRedis = {
      get: async (key) => key === 'helprr:cache:generation' ? '1' : null,
      scan: async () => { throw new Error('Redis unavailable'); },
    };

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
});
