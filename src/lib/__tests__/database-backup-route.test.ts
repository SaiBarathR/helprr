import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ admin: vi.fn(), findUnique: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireAdmin: mocks.admin }));
vi.mock('@/lib/db', () => ({ prisma: { appSettings: { findUnique: mocks.findUnique } } }));

const { GET } = await import('@/app/api/admin/database-backup/route');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/api/admin/database-backup', () => {
  it('returns the last recorded backup time to an admin, uncached', async () => {
    mocks.admin.mockResolvedValue({ ok: true, user: { id: 'a', role: 'admin' } });
    mocks.findUnique.mockResolvedValue({ lastDatabaseBackupAt: new Date('2026-11-04T03:00:00.000Z') });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await res.json()).toEqual({ lastBackupAt: '2026-11-04T03:00:00.000Z' });
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { id: 'singleton' }, select: { lastDatabaseBackupAt: true } });
  });

  it('says none when no backup was recorded or there is no settings row', async () => {
    mocks.admin.mockResolvedValue({ ok: true, user: { id: 'a', role: 'admin' } });
    for (const row of [{ lastDatabaseBackupAt: null }, null]) {
      mocks.findUnique.mockResolvedValueOnce(row);
      expect(await (await GET()).json()).toEqual({ lastBackupAt: null });
    }
  });

  it('refuses anyone else before reading anything', async () => {
    for (const status of [401, 403]) {
      mocks.admin.mockResolvedValueOnce({ ok: false, response: new Response(null, { status }) });
      expect((await GET()).status).toBe(status);
    }
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
});
