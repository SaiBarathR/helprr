import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Deleting the Jellyfin connection turns "Sign in with Jellyfin" off, and its
// external URL builds the "Open in Jellyfin" links everyone follows, so both
// are for an admin, whatever capabilities a member holds. Other services are
// unchanged.

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  recordSecurityEvent: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.auth }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));
vi.mock('@/lib/db', () => ({
  prisma: { serviceConnection: { findUnique: mocks.findUnique, update: mocks.update, delete: mocks.remove } },
}));
vi.mock('@/lib/security-audit', () => ({
  recordSecurityEvent: mocks.recordSecurityEvent,
  changedFieldNames: () => [],
  serviceTargetLabel: (type: string) => type,
}));
vi.mock('@/lib/arr-instances', () => ({
  clearConnectionMemo: vi.fn(),
  ensureDefaultForType: vi.fn(),
  setDefaultConnection: vi.fn(),
}));
vi.mock('@/lib/cache/tagged-library', () => ({ invalidateTaggedLibrary: vi.fn() }));

import { DELETE as deleteConnection } from '@/app/api/services/[id]/route';
import { PUT as putExternalUrl } from '@/app/api/services/external-url/route';

const admin = { ok: true, user: { id: 'admin-1', username: 'boss', role: 'admin' }, session: { id: 's-admin' } };
const member = { ok: true, user: { id: 'member-1', username: 'kid', role: 'member' }, session: { id: 's-member' } };
const jellyfin = { id: 'jf-1', type: 'JELLYFIN', label: 'Jellyfin', externalUrl: 'https://jf.example.com' };
const sonarr = { id: 'so-1', type: 'SONARR', label: 'Main', externalUrl: null };

const remove = (id: string) =>
  deleteConnection(new NextRequest(`http://helprr.test/api/services/${id}`, { method: 'DELETE' }), { params: Promise.resolve({ id }) });
const setExternalUrl = (id: string, externalUrl: string) =>
  putExternalUrl(new NextRequest('http://helprr.test/api/services/external-url', {
    method: 'PUT',
    body: JSON.stringify({ id, externalUrl }),
  }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockImplementation(async ({ where, data }) => ({ ...(where.id === sonarr.id ? sonarr : jellyfin), ...data }));
});

describe('deleting the Jellyfin connection', () => {
  beforeEach(() => mocks.findUnique.mockResolvedValue(jellyfin));

  it('is refused for a member with settings.instances, and nothing is deleted or audited', async () => {
    mocks.auth.mockResolvedValue(member);
    const res = await remove('jf-1');
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Only an admin/);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.recordSecurityEvent).not.toHaveBeenCalled();
  });

  it('works for an admin, audited as before', async () => {
    mocks.auth.mockResolvedValue(admin);
    expect((await remove('jf-1')).status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith({ where: { id: 'jf-1' } });
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actor: admin.user, action: 'SERVICE_DELETED', targetType: 'service', targetId: 'jf-1',
    }));
  });

  it('other services: a member still deletes them', async () => {
    mocks.auth.mockResolvedValue(member);
    mocks.findUnique.mockResolvedValue(sonarr);
    expect((await remove('so-1')).status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith({ where: { id: 'so-1' } });
  });
});

describe("Jellyfin's external URL", () => {
  beforeEach(() => mocks.findUnique.mockResolvedValue(jellyfin));

  it.each([
    ['change', 'https://evil.example'],
    ['clear', ''],
  ])('a member cannot %s it', async (_label, value) => {
    mocks.auth.mockResolvedValue(member);
    const res = await setExternalUrl('jf-1', value);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Only an admin/);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('a member cannot set it when there is none', async () => {
    mocks.auth.mockResolvedValue(member);
    mocks.findUnique.mockResolvedValue({ ...jellyfin, externalUrl: null });
    expect((await setExternalUrl('jf-1', 'https://evil.example')).status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("a member's save of the same value writes nothing", async () => {
    mocks.auth.mockResolvedValue(member);
    const res = await setExternalUrl('jf-1', 'https://jf.example.com/');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'jf-1', type: 'JELLYFIN', externalUrl: 'https://jf.example.com' });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('an admin changes it, audited as before', async () => {
    mocks.auth.mockResolvedValue(admin);
    const res = await setExternalUrl('jf-1', 'https://new.example.com');
    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'jf-1' }, data: { externalUrl: 'https://new.example.com' } });
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'SERVICE_UPDATED', fields: ['externalUrl'],
    }));
  });

  it('other services: a member still sets theirs', async () => {
    mocks.auth.mockResolvedValue(member);
    mocks.findUnique.mockResolvedValue(sonarr);
    expect((await setExternalUrl('so-1', 'https://sonarr.example.com')).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'so-1' }, data: { externalUrl: 'https://sonarr.example.com' } });
  });
});
