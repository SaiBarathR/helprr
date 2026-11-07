import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// An in-memory user, recovery-code and session table. The transaction restores
// the snapshot when its callback throws, and runs one callback at a time, as
// the row lock on the user does in PostgreSQL.
const db = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const state = { users: [] as Row[], codes: [] as Row[], sessions: [] as Row[] };
  let queue: Promise<unknown> = Promise.resolve();
  const client = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: Row }) => {
        const row = state.users.find((u) => u.id === where.id);
        return row ? { id: row.id, username: row.username } : null;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const rows = state.users.filter((u) => u.id === where.id && u.totpEnabledAt !== null);
        rows.forEach((u) => Object.assign(u, data));
        return { count: rows.length };
      }),
    },
    recoveryCode: {
      deleteMany: vi.fn(async ({ where }: { where: Row }) => {
        const before = state.codes.length;
        state.codes = state.codes.filter((c) => c.userId !== where.userId);
        return { count: before - state.codes.length };
      }),
    },
    session: {
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const rows = state.sessions.filter((s) => s.userId === where.userId && s.revokedAt === null);
        rows.forEach((s) => Object.assign(s, data));
        return { count: rows.length };
      }),
    },
    $transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => {
      const run = queue.then(async () => {
        const snapshot = structuredClone(state);
        try {
          return await fn(client);
        } catch (error) {
          Object.assign(state, snapshot);
          throw error;
        }
      });
      queue = run.catch(() => {});
      return run;
    }),
  };
  return { state, client };
});

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), recordSecurityEvent: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: db.client }));
vi.mock('@/lib/auth', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/security-audit', () => ({ recordSecurityEvent: mocks.recordSecurityEvent }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));

import { DELETE } from './route';

const admin = { id: 'admin-1', username: 'boss', role: 'admin' };

function call(id: string) {
  return DELETE(new NextRequest(`http://localhost/api/users/${id}/totp`, { method: 'DELETE' }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.state.users = [
    { id: 'u1', username: 'member', totpSecret: 'enc:v1:x', totpEnabledAt: new Date('2026-11-01'), totpLastUsedStep: 5 },
    { id: 'admin-1', username: 'boss', totpSecret: 'enc:v1:y', totpEnabledAt: new Date('2026-11-01'), totpLastUsedStep: 7 },
  ];
  db.state.codes = [{ userId: 'u1' }, { userId: 'u1' }, { userId: 'admin-1' }];
  db.state.sessions = [
    { id: 's1', userId: 'u1', revokedAt: null },
    { id: 's2', userId: 'u1', revokedAt: null },
    { id: 's3', userId: 'admin-1', revokedAt: null },
  ];
  mocks.requireAdmin.mockResolvedValue({ ok: true, user: admin, session: { id: 's3' } });
});

describe('DELETE /api/users/[id]/totp', () => {
  it('turns it off, deletes the recovery codes and ends every session of the user, in one transaction', async () => {
    const response = await call('u1');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, revokedSessions: 2 });

    expect(db.state.users[0]).toMatchObject({ totpSecret: null, totpEnabledAt: null, totpLastUsedStep: null });
    expect(db.state.codes).toEqual([{ userId: 'admin-1' }]);
    expect(db.state.sessions.filter((s) => s.revokedAt !== null).map((s) => s.id)).toEqual(['s1', 's2']);
    expect(db.client.$transaction).toHaveBeenCalledTimes(1);
    // The admin's own account is untouched.
    expect(db.state.users[1].totpEnabledAt).not.toBeNull();

    expect(mocks.recordSecurityEvent).toHaveBeenCalledTimes(1);
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), {
      actor: admin,
      action: 'MFA_DISABLED',
      targetType: 'user',
      targetId: 'u1',
      targetLabel: 'member',
      fields: ['admin'],
      count: 2,
    });
  });

  it('is for admins only', async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, response: Response.json({ error: 'Forbidden' }, { status: 403 }) });
    expect((await call('u1')).status).toBe(403);
    expect(db.client.$transaction).not.toHaveBeenCalled();
    expect(db.state.users[0].totpEnabledAt).not.toBeNull();
  });

  it("refuses the admin's own account, which needs the password and a code", async () => {
    expect((await call('admin-1')).status).toBe(409);
    expect(db.client.$transaction).not.toHaveBeenCalled();
    expect(db.state.users[1].totpEnabledAt).not.toBeNull();
  });

  it('404s an unknown user', async () => {
    expect((await call('nobody')).status).toBe(404);
    expect(mocks.recordSecurityEvent).not.toHaveBeenCalled();
  });

  it('409s when it is already off, and changes nothing', async () => {
    db.state.users[0].totpEnabledAt = null;
    expect((await call('u1')).status).toBe(409);
    expect(db.state.codes).toHaveLength(3);
    expect(db.state.sessions.every((s) => s.revokedAt === null)).toBe(true);
    expect(mocks.recordSecurityEvent).not.toHaveBeenCalled();
  });

  it('two admins at once: one turns it off, the other gets a conflict, one audit row', async () => {
    const [a, b] = await Promise.all([call('u1'), call('u1')]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(mocks.recordSecurityEvent).toHaveBeenCalledTimes(1);
  });

  it('a failure inside the transaction leaves two-step sign-in on', async () => {
    db.client.session.updateMany.mockRejectedValueOnce(new Error('connection lost'));
    await expect(call('u1')).rejects.toThrow('connection lost');
    expect(db.state.users[0].totpEnabledAt).not.toBeNull();
    expect(db.state.codes).toHaveLength(3);
    expect(mocks.recordSecurityEvent).not.toHaveBeenCalled();
  });
});
