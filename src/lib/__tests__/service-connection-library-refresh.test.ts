import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Adding or re-pointing an instance changes the combined library (and, re-pointed,
 * its quality profile and tag names). The [id] routes already drop the cached
 * library on update and delete; saving through POST /api/services did not, so a just-added instance's titles were missing
 * from the "all instances" list until the cache expired (found with a
 * 20,000-film instance in rel-scale-and-failure-tests).
 */

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUserCapability: async () => ({ ok: true, user: { id: 'admin' } }) }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));
vi.mock('@/lib/db', () => ({
  prisma: { serviceConnection: { findFirst: vi.fn(), findUnique: mocks.findUnique, update: mocks.update, create: mocks.create } },
}));
vi.mock('@/lib/cache/reference-labels', () => ({ invalidateReferenceLabels: mocks.invalidate }));
vi.mock('@/lib/radarr-client', () => ({ RadarrClient: class { getSystemStatus = async () => ({ version: '5.0.0' }); } }));
vi.mock('@/lib/arr-instances', () => ({
  clearConnectionMemo: vi.fn(),
  ensureDefaultForType: vi.fn(),
  isArrType: (type: string) => ['SONARR', 'RADARR', 'LIDARR'].includes(type),
}));

import { POST } from '@/app/api/services/route';

const row = (id: string) => ({ id, type: 'RADARR', label: 'radarr-4k', url: 'http://radarr-4k:7878', apiKey: 'k'.repeat(32), username: null, isDefault: false, externalUrl: null, customHeaders: {}, createdAt: new Date(), updatedAt: new Date() });
const save = (body: Record<string, unknown>) => POST(new NextRequest('http://helprr.test/api/services', {
  method: 'POST',
  body: JSON.stringify({ type: 'RADARR', label: 'radarr-4k', url: 'http://radarr-4k:7878', apiKey: 'k'.repeat(32), ...body }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue(row('new-radarr'));
  mocks.update.mockResolvedValue(row('existing-radarr'));
  mocks.findUnique.mockResolvedValue(row('existing-radarr'));
});

describe('POST /api/services refreshes the combined library', () => {
  it('drops the cached library when an instance is added', async () => {
    expect((await save({})).status).toBe(200);
    expect(mocks.invalidate).toHaveBeenCalledWith('radarr', 'new-radarr');
  });

  it('drops it, labels included, when an instance is saved with a new address', async () => {
    expect((await save({ id: 'existing-radarr', url: 'http://radarr-4k-new:7878' })).status).toBe(200);
    expect(mocks.invalidate).toHaveBeenCalledWith('radarr', 'existing-radarr');
  });
});
