import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Prowlarr, Jellyfin, TMDB, Seerr and the other single-instance types have
// one connection each. A POST without an id used to replace it, whatever the
// request named, and a script adding "another" Prowlarr overwrote the real
// one's address and key. Now it is refused; an edit names the connection.

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  recordSecurityEvent: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.auth }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));
vi.mock('@/lib/db', () => ({
  prisma: {
    serviceConnection: { findFirst: mocks.findFirst, findUnique: mocks.findUnique, findMany: vi.fn().mockResolvedValue([]), update: mocks.update, create: mocks.create },
  },
}));
vi.mock('@/lib/security-audit', () => ({
  recordSecurityEvent: mocks.recordSecurityEvent,
  changedFieldNames: (a: Record<string, unknown>, b: Record<string, unknown>, keys: string[]) => keys.filter((k) => a[k] !== b[k]),
  serviceTargetLabel: () => 'Prowlarr',
}));
vi.mock('@/lib/arr-instances', () => ({
  clearConnectionMemo: vi.fn(),
  ensureDefaultForType: vi.fn(),
  isArrType: (type: string) => ['SONARR', 'RADARR', 'LIDARR'].includes(type),
  isMultiInstanceType: (type: string) => ['SONARR', 'RADARR', 'LIDARR', 'QBITTORRENT'].includes(type),
}));
vi.mock('@/lib/cache/reference-labels', () => ({ invalidateReferenceLabels: vi.fn() }));

import { POST as saveConnection } from '@/app/api/services/route';

const prowlarr = {
  id: 'pr-1', type: 'PROWLARR', label: 'Prowlarr', isDefault: true, url: 'http://prowlarr.lan:9696', apiKey: 'real-key-0123456789',
  username: null, externalUrl: null, customHeaders: null, createdAt: new Date(), updatedAt: new Date(),
};

const save = (body: Record<string, unknown>) =>
  saveConnection(new NextRequest('http://helprr.test/api/services', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, user: { id: 'admin-1', username: 'boss', role: 'admin' }, session: { id: 's1' } });
  mocks.findFirst.mockResolvedValue(prowlarr);
  mocks.findUnique.mockResolvedValue(prowlarr);
  mocks.update.mockImplementation(async ({ data }) => ({ ...prowlarr, ...data }));
  mocks.create.mockImplementation(async ({ data }) => ({ ...prowlarr, id: 'new', ...data }));
});

describe('POST /api/services for a single-instance type', () => {
  it('refuses one without an id while that type is connected, and changes nothing', async () => {
    const res = await save({ type: 'PROWLARR', label: 'QA Prowlarr', url: 'http://other.lan:9696', apiKey: 'other-key' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('A Prowlarr connection already exists; edit it instead');
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.recordSecurityEvent).not.toHaveBeenCalled();
  });

  it('adds the first one without an id', async () => {
    mocks.findFirst.mockResolvedValue(null);
    const res = await save({ type: 'PROWLARR', url: 'http://prowlarr.lan:9696', apiKey: 'a-key' });
    expect(res.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'PROWLARR', label: 'Prowlarr', url: 'http://prowlarr.lan:9696' }),
    }));
  });

  it('edits it when the request names it by id', async () => {
    const res = await save({ id: 'pr-1', type: 'PROWLARR', url: 'http://prowlarr.lan:9797', apiKey: 'new-key' });
    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'pr-1' },
      data: expect.objectContaining({ url: 'http://prowlarr.lan:9797', apiKey: 'new-key' }),
    }));
  });

  it('still adds another instance of a multi-instance type without an id', async () => {
    mocks.findFirst.mockResolvedValue({ ...prowlarr, id: 'so-1', type: 'SONARR', label: 'Main' });
    const res = await save({ type: 'SONARR', label: 'Anime', url: 'http://sonarr.lan:8990', apiKey: 'k' });
    expect(res.status).toBe(200);
    expect(mocks.create).toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
