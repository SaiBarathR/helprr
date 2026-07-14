import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => {
  const tx = {
    user: {
      count: vi.fn(),
      update: vi.fn(),
    },
    session: {
      updateMany: vi.fn(),
    },
  };
  return {
    tx,
    requireAdmin: vi.fn(),
    hashPassword: vi.fn(),
    userCreate: vi.fn(),
    userFindUnique: vi.fn(),
    transaction: vi.fn(),
  };
});

vi.mock('@/lib/auth', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/password', () => ({ hashPassword: mocks.hashPassword }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      create: mocks.userCreate,
      findUnique: mocks.userFindUnique,
    },
    $transaction: mocks.transaction,
  },
}));

import { POST as createUser } from '@/app/api/users/route';
import { PATCH as updateUser } from '@/app/api/users/[id]/route';

const existingUser = {
  id: 'user-1',
  username: 'member',
  displayName: 'Member',
  passwordHash: 'old-hash',
  role: 'member',
  status: 'active',
  template: 'member',
  permissions: {},
  jellyfinUserId: null,
  seerrUserId: null,
  jellyfinToken: null,
  createdAt: new Date('2026-07-14T00:00:00Z'),
  updatedAt: new Date('2026-07-14T00:00:00Z'),
};

function jsonRequest(pathname: string, method: 'POST' | 'PATCH', body: unknown): NextRequest {
  return new NextRequest(`http://localhost${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: existingUser.id }) };

describe('user local-password boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({
      ok: true,
      user: { id: 'admin-1', role: 'admin' },
      session: { id: 'admin-session' },
    });
    mocks.hashPassword.mockResolvedValue('new-hash');
    mocks.userFindUnique.mockResolvedValue(existingUser);
    mocks.userCreate.mockImplementation(async ({ data }) => ({
      ...existingUser,
      id: 'created-user',
      ...data,
    }));
    mocks.tx.user.count.mockResolvedValue(1);
    mocks.tx.user.update.mockImplementation(async ({ data }) => ({ ...existingUser, ...data }));
    mocks.tx.session.updateMany.mockResolvedValue({ count: 2 });
    mocks.transaction.mockImplementation(async (callback) => callback(mocks.tx));
  });

  it('rejects a short password when creating a local account', async () => {
    const response = await createUser(
      jsonRequest('/api/users', 'POST', {
        username: 'new-member',
        displayName: 'New Member',
        password: 'a'.repeat(14),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Password must be at least 15 characters',
    });
    expect(mocks.hashPassword).not.toHaveBeenCalled();
    expect(mocks.userCreate).not.toHaveBeenCalled();
  });

  it('accepts a 15-character password and still permits Jellyfin-only accounts', async () => {
    const localResponse = await createUser(
      jsonRequest('/api/users', 'POST', {
        username: 'local-member',
        displayName: 'Local Member',
        password: 'a'.repeat(15),
      }),
    );
    const jellyfinResponse = await createUser(
      jsonRequest('/api/users', 'POST', {
        username: 'jellyfin-member',
        displayName: 'Jellyfin Member',
        jellyfinUserId: 'jf-1',
      }),
    );

    expect(localResponse.status).toBe(201);
    expect(jellyfinResponse.status).toBe(201);
    expect(mocks.hashPassword).toHaveBeenCalledOnce();
    expect(mocks.userCreate).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ passwordHash: null, jellyfinUserId: 'jf-1' }),
    });
  });

  it('rejects a short password reset before opening a transaction', async () => {
    const response = await updateUser(
      jsonRequest('/api/users/user-1', 'PATCH', { password: 'short' }),
      params,
    );

    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.hashPassword).not.toHaveBeenCalled();
  });

  it('atomically revokes all active sessions when an admin resets a password', async () => {
    const response = await updateUser(
      jsonRequest('/api/users/user-1', 'PATCH', { password: 'a'.repeat(15) }),
      params,
    );

    expect(response.status).toBe(200);
    expect(mocks.tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { passwordHash: 'new-hash' },
    });
    expect(mocks.tx.session.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('realigns role permissions without revoking sessions', async () => {
    const response = await updateUser(
      jsonRequest('/api/users/user-1', 'PATCH', { role: 'admin' }),
      params,
    );

    expect(response.status).toBe(200);
    expect(mocks.tx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { role: 'admin', template: 'admin', permissions: {} },
    });
    expect(mocks.tx.session.updateMany).not.toHaveBeenCalled();
  });
});
