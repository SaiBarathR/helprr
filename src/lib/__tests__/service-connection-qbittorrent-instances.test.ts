import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * QBT-29: Settings → Instances adds a second qBittorrent instead of replacing
 * the one there is, as it does for the arrs: a save without an id is a new
 * connection, it needs a name, and an id names the one to edit.
 */
const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  ensureDefault: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUserCapability: async () => ({ ok: true, user: { id: 'admin', role: 'admin' }, session: { id: 's1' } }) }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));
vi.mock('@/lib/security-audit', () => ({ recordSecurityEvent: vi.fn(), changedFieldNames: () => [], serviceTargetLabel: (_type: string, label: string) => label }));
vi.mock('@/lib/db', () => ({
  prisma: { serviceConnection: { findFirst: mocks.findFirst, findMany: mocks.findMany, findUnique: mocks.findUnique, update: mocks.update, create: mocks.create } },
}));
vi.mock('@/lib/cache/reference-labels', () => ({ invalidateReferenceLabels: vi.fn() }));
vi.mock('@/lib/arr-instances', () => ({
  clearConnectionMemo: vi.fn(),
  ensureDefaultForType: mocks.ensureDefault,
  isArrType: (type: string) => ['SONARR', 'RADARR', 'LIDARR'].includes(type),
  isMultiInstanceType: (type: string) => ['SONARR', 'RADARR', 'LIDARR', 'QBITTORRENT'].includes(type),
}));

import { POST } from '@/app/api/services/route';

const existing = { id: 'qbit-main', type: 'QBITTORRENT', label: 'qBittorrent', isDefault: true, url: 'http://qbit-main:8080', apiKey: 'main-password', username: 'admin', externalUrl: null, customHeaders: {}, createdAt: new Date(), updatedAt: new Date() };
const save = (body: Record<string, unknown>) => POST(new NextRequest('http://helprr.test/api/services', {
  method: 'POST',
  body: JSON.stringify({ type: 'QBITTORRENT', url: 'http://seedbox:8080', apiKey: 'seedbox-password', username: 'admin', ...body }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Before multi-instance, a qBittorrent save without an id found this one and overwrote it.
  mocks.findFirst.mockResolvedValue(existing);
  mocks.findUnique.mockResolvedValue(existing);
  mocks.findMany.mockImplementation(async ({ where }: { where: { id?: { not: string } } }) => [existing].filter((row) => row.id !== where.id?.not));
  mocks.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...existing, ...data, id: 'qbit-seedbox', isDefault: false }));
  mocks.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...existing, ...data }));
});

describe('POST /api/services for qBittorrent (QBT-29)', () => {
  it('adds a second qBittorrent, named, without touching the first', async () => {
    const res = await save({ label: 'Seedbox' });
    expect(res.status).toBe(200);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: 'QBITTORRENT', label: 'Seedbox', url: 'http://seedbox:8080' }) });
    // One default per type: the first stays it.
    expect(mocks.ensureDefault).toHaveBeenCalledWith('QBITTORRENT');
  });

  it('needs a name for a new one', async () => {
    const res = await save({});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'A name is required for this instance' });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('refuses a second connection to a qBittorrent already connected', async () => {
    const res = await save({ label: 'Again', url: 'http://qbit-main:8080/' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'This qBittorrent is already connected as "qBittorrent"' });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('edits the one an id names', async () => {
    const res = await save({ id: 'qbit-main', label: 'Main', url: 'http://qbit-main:8080', apiKey: 'main-password' });
    expect(res.status).toBe(200);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'qbit-main' }, data: expect.objectContaining({ label: 'Main' }) });
  });
});
