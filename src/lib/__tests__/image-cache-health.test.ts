import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRedisClient: vi.fn(),
}));

vi.mock('@/lib/redis', () => ({ getRedisClient: mocks.getRedisClient }));

const roots: string[] = [];

class StartupRedis {
  readonly values = new Map<string, string>([['helprr:cache:generation', '1']]);

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string, options?: { NX?: boolean }): Promise<string | null> {
    if (options?.NX && this.values.has(key)) return null;
    this.values.set(key, value);
    return 'OK';
  }

  async scan(): Promise<{ cursor: string; keys: string[] }> {
    return { cursor: '0', keys: [] };
  }

  async hGetAll(): Promise<Record<string, string>> {
    return {};
  }

  async eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown> {
    if (script.includes('image-cache-reconcile-v1')) return ['OK', '0', '0'];
    if (script.includes('image-cache-release-lock-v1')) {
      if (this.values.get(options.keys[0]!) === options.arguments[0]) {
        this.values.delete(options.keys[0]!);
      }
      return 1;
    }
    if (script.includes('image-cache-renew-maintenance-lock-v1')) return 1;
    throw new Error('Unexpected script');
  }
}

async function loadHealth(root: string) {
  process.env.IMAGE_CACHE_DIR = root;
  vi.resetModules();
  return import('@/lib/cache/image-cache-health');
}

beforeEach(() => vi.clearAllMocks());

afterEach(() => {
  delete process.env.IMAGE_CACHE_DIR;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('image cache startup health', () => {
  it('creates and probes the active generation before reconciling it', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'helprr-image-health-'));
    roots.push(root);
    mocks.getRedisClient.mockResolvedValue(new StartupRedis());
    const { initializeImageCacheStorage } = await loadHealth(root);

    await expect(initializeImageCacheStorage()).resolves.toMatchObject({ status: 'healthy' });
    expect(existsSync(path.join(root, 'v1'))).toBe(true);
    expect(readdirSync(root).some((entry) => entry.startsWith('.write-probe-'))).toBe(false);
    expect(readdirSync(path.join(root, 'v1'))).toEqual([]);
  });

  it('reports accounting unavailable after a successful storage probe', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'helprr-image-no-accounting-'));
    roots.push(root);
    mocks.getRedisClient.mockRejectedValue(new Error('Redis unavailable'));
    const { initializeImageCacheStorage } = await loadHealth(root);

    await expect(initializeImageCacheStorage()).resolves.toMatchObject({
      status: 'accounting-unavailable',
    });
    expect(readdirSync(root)).toEqual([]);
  });

  it('reports accounting unavailable when generation lookup fails', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'helprr-image-generation-failure-'));
    roots.push(root);
    const redis = new StartupRedis();
    vi.spyOn(redis, 'get').mockRejectedValue(new Error('Redis read failed'));
    mocks.getRedisClient.mockResolvedValue(redis);
    const { initializeImageCacheStorage } = await loadHealth(root);

    await expect(initializeImageCacheStorage()).resolves.toMatchObject({
      status: 'accounting-unavailable',
    });
  });

  it('reports degraded storage without exposing or depending on Redis', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'helprr-image-degraded-'));
    roots.push(root);
    const filePath = path.join(root, 'not-a-directory');
    writeFileSync(filePath, 'occupied');
    const { initializeImageCacheStorage } = await loadHealth(filePath);

    await expect(initializeImageCacheStorage()).resolves.toMatchObject({
      status: 'degraded-storage',
    });
    expect(mocks.getRedisClient).not.toHaveBeenCalled();
  });
});
