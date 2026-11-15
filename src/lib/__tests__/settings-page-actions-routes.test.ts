import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { can } from '@/lib/permissions';
import type { Capability } from '@/lib/capabilities';

// The Logging page's "Delete all log files" and the Storage page's cleanup
// history summary, Clear older and Clear all come with the page's own settings
// capability (owner, 2026-11-14). The other uses of the same routes (one log
// file from the Logs viewer, the rows and filtered deletes from the Cleanup
// page) keep their own capabilities.

type TestUser = { id: string; username: string; role: 'admin' | 'member'; template: string; permissions: Record<string, boolean> };

const mocks = vi.hoisted(() => ({
  user: null as unknown as TestUser,
  listLogFiles: vi.fn(),
  deleteLogFile: vi.fn(),
  aggregate: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  deleteMany: vi.fn(),
  recordRecordsDeleted: vi.fn(),
}));

const forbidden = () => ({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });

// The real capability checks, over the test's user.
vi.mock('@/lib/auth', () => ({
  requireUserCapability: vi.fn(async (cap: Capability) =>
    can(mocks.user as never, cap) ? { ok: true, user: mocks.user } : forbidden()),
  requireUserAnyCapability: vi.fn(async (caps: Capability[]) =>
    caps.some((cap) => can(mocks.user as never, cap)) ? { ok: true, user: mocks.user } : forbidden()),
}));
vi.mock('@/lib/logger', () => ({ listLogFiles: mocks.listLogFiles, deleteLogFile: mocks.deleteLogFile }));
vi.mock('@/lib/db', () => ({
  prisma: {
    cleanupHistory: {
      aggregate: mocks.aggregate, findMany: mocks.findMany, count: mocks.count, deleteMany: mocks.deleteMany,
    },
  },
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/security-audit', () => ({ recordRecordsDeleted: mocks.recordRecordsDeleted }));

const logs = await import('@/app/api/logs/files/route');
const history = await import('@/app/api/cleanup/history/route');

type Handler = (request: NextRequest) => Promise<Response>;
const deleteLogs = logs.DELETE as unknown as Handler;
const getHistory = history.GET as unknown as Handler;
const deleteHistory = history.DELETE as unknown as Handler;

function member(...caps: Capability[]): TestUser {
  return { id: 'm1', username: 'member', role: 'member', template: 'member', permissions: Object.fromEntries(caps.map((cap) => [cap, true])) };
}
const admin: TestUser = { id: 'a1', username: 'admin', role: 'admin', template: 'admin', permissions: {} };

const req = (path: string, method = 'GET') => new NextRequest(`http://localhost${path}`, { method });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listLogFiles.mockResolvedValue([{ name: 'helprr-2026-11-14.jsonl' }]);
  mocks.deleteLogFile.mockResolvedValue(undefined);
  mocks.aggregate.mockResolvedValue({ _count: { _all: 3 }, _min: { createdAt: new Date('2026-11-01T00:00:00Z') } });
  mocks.findMany.mockResolvedValue([]);
  mocks.count.mockResolvedValue(0);
  mocks.deleteMany.mockResolvedValue({ count: 3 });
});

describe('DELETE /api/logs/files', () => {
  it('lets "Logging settings" delete all log files, as "Delete logs" and admins can', async () => {
    for (const user of [member('settings.logging'), member('logs.manage'), admin]) {
      mocks.user = user;
      expect((await deleteLogs(req('/api/logs/files?all=true', 'DELETE'))).status).toBe(200);
    }
    expect(mocks.deleteLogFile).toHaveBeenCalledTimes(3);
  });

  it('keeps deleting one file (the Logs viewer) to "Delete logs"', async () => {
    mocks.user = member('settings.logging');
    expect((await deleteLogs(req('/api/logs/files?file=helprr-2026-11-14.jsonl', 'DELETE'))).status).toBe(403);
    mocks.user = member('logs.manage');
    expect((await deleteLogs(req('/api/logs/files?file=helprr-2026-11-14.jsonl', 'DELETE'))).status).toBe(200);
  });

  it('records who deleted log files in the security log, even when a later file fails', async () => {
    mocks.user = member('settings.logging');
    mocks.listLogFiles.mockResolvedValue([{ name: 'a.jsonl' }, { name: 'b.jsonl' }, { name: 'c.jsonl' }]);
    await deleteLogs(req('/api/logs/files?all=true', 'DELETE'));
    expect(mocks.recordRecordsDeleted).toHaveBeenLastCalledWith(expect.any(NextRequest), mocks.user, 'logs', 'all', 3);

    mocks.deleteLogFile
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'EBUSY' }));
    expect((await deleteLogs(req('/api/logs/files?all=true', 'DELETE'))).status).toBe(500);
    expect(mocks.recordRecordsDeleted).toHaveBeenLastCalledWith(expect.any(NextRequest), mocks.user, 'logs', 'all', 1);

    mocks.user = member('logs.manage');
    await deleteLogs(req('/api/logs/files?file=a.jsonl', 'DELETE'));
    expect(mocks.recordRecordsDeleted).toHaveBeenLastCalledWith(expect.any(NextRequest), mocks.user, 'logs', 'a.jsonl', 1);
  });

  it('records nothing when a refused or failed delete removed nothing', async () => {
    mocks.user = member();
    await deleteLogs(req('/api/logs/files?all=true', 'DELETE'));
    mocks.user = member('logs.manage');
    mocks.deleteLogFile.mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 'ENOENT' }));
    expect((await deleteLogs(req('/api/logs/files?file=a.jsonl', 'DELETE'))).status).toBe(404);
    expect(mocks.recordRecordsDeleted).not.toHaveBeenCalled();
  });

  it('refuses a member with neither, or with only a neighbouring page, and deletes nothing', async () => {
    for (const user of [member(), member('settings.storage'), member('logs.view')]) {
      mocks.user = user;
      expect((await deleteLogs(req('/api/logs/files?all=true', 'DELETE'))).status).toBe(403);
    }
    expect(mocks.listLogFiles).not.toHaveBeenCalled();
    expect(mocks.deleteLogFile).not.toHaveBeenCalled();
  });
});

describe('/api/cleanup/history', () => {
  it('gives "Storage / cache" the summary, but not the rows', async () => {
    mocks.user = member('settings.storage');
    const res = await getHistory(req('/api/cleanup/history?summary=true'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ total: 3, oldestAt: '2026-11-01T00:00:00.000Z' });
    expect((await getHistory(req('/api/cleanup/history'))).status).toBe(403);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it('lets "Storage / cache" Clear all and Clear older', async () => {
    mocks.user = member('settings.storage');
    expect((await deleteHistory(req('/api/cleanup/history?all=true', 'DELETE'))).status).toBe(200);
    expect(mocks.deleteMany).toHaveBeenLastCalledWith({});
    expect((await deleteHistory(req('/api/cleanup/history?olderThanDays=30', 'DELETE'))).status).toBe(200);
    expect(mocks.deleteMany).toHaveBeenLastCalledWith({ where: { createdAt: { lt: expect.any(Date) } } });
  });

  it('records who cleared cleanup history, and how', async () => {
    mocks.user = member('settings.storage');
    await deleteHistory(req('/api/cleanup/history?all=true', 'DELETE'));
    expect(mocks.recordRecordsDeleted).toHaveBeenLastCalledWith(expect.any(NextRequest), mocks.user, 'cleanup-history', 'all', 3);
    await deleteHistory(req('/api/cleanup/history?olderThanDays=30', 'DELETE'));
    expect(mocks.recordRecordsDeleted).toHaveBeenLastCalledWith(expect.any(NextRequest), mocks.user, 'cleanup-history', 'older than 30 days', 3);
    mocks.user = member('cleanup.manage');
    await deleteHistory(req('/api/cleanup/history?cleaner=queue', 'DELETE'));
    expect(mocks.recordRecordsDeleted).toHaveBeenLastCalledWith(expect.any(NextRequest), mocks.user, 'cleanup-history', 'filtered', 3);
  });

  it('keeps a filtered delete (the Cleanup page) to cleanup.manage', async () => {
    mocks.user = member('settings.storage');
    expect((await deleteHistory(req('/api/cleanup/history?cleaner=queue', 'DELETE'))).status).toBe(403);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses a member without either capability, and clears nothing', async () => {
    for (const user of [member(), member('settings.logging'), member('cleanup.view')]) {
      mocks.user = user;
      expect((await deleteHistory(req('/api/cleanup/history?all=true', 'DELETE'))).status).toBe(403);
      expect((await deleteHistory(req('/api/cleanup/history?olderThanDays=30', 'DELETE'))).status).toBe(403);
    }
    mocks.user = member('settings.logging');
    expect((await getHistory(req('/api/cleanup/history?summary=true'))).status).toBe(403);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
    expect(mocks.aggregate).not.toHaveBeenCalled();
  });

  it('still lets cleanup.view and cleanup.manage do what they did', async () => {
    mocks.user = member('cleanup.view', 'cleanup.manage');
    expect((await getHistory(req('/api/cleanup/history'))).status).toBe(200);
    expect((await getHistory(req('/api/cleanup/history?summary=true'))).status).toBe(200);
    expect((await deleteHistory(req('/api/cleanup/history?all=true', 'DELETE'))).status).toBe(200);
  });
});
