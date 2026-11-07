import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  revokeSession: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  apiTokenDeleteMany: vi.fn(async () => ({ count: 1 })),
}));

vi.mock('@/lib/auth', () => ({
  COOKIE_NAME: 'helprr-session',
  requireUser: mocks.requireUser,
  revokeSession: mocks.revokeSession,
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    session: {
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
    },
    apiToken: { deleteMany: mocks.apiTokenDeleteMany },
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  },
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));

import { POST as revokeOne } from '@/app/api/sessions/[id]/revoke/route';
import { POST as revokeOthers } from '@/app/api/sessions/revoke-others/route';

function request(): NextRequest {
  return new NextRequest('http://localhost/api/sessions/session-current/revoke', {
    method: 'POST',
  });
}

function auth(role: 'admin' | 'member' = 'member') {
  return {
    ok: true,
    user: { id: 'user-1', role },
    session: { id: 'session-current' },
  };
}

describe('session revocation routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue(auth());
    mocks.revokeSession.mockResolvedValue(undefined);
    mocks.updateMany.mockResolvedValue({ count: 2 });
  });

  it('revokes the current session, clears its cookie and leaves the signed-out marker', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'session-current',
      revokedAt: null,
      userId: 'user-1',
    });

    const response = await revokeOne(request(), {
      params: Promise.resolve({ id: 'session-current' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ revoked: 1, wasCurrent: true });
    expect(mocks.revokeSession).toHaveBeenCalledWith('session-current');
    expect(response.headers.get('set-cookie')).toContain('helprr-session=');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    // So proxy sign-in does not sign this browser straight back in.
    expect(response.headers.getSetCookie().some((c) => c.startsWith('helprr-signed-out=1'))).toBe(true);
  });

  it('prevents a member from probing or revoking another user session', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'other-session',
      revokedAt: null,
      userId: 'user-2',
    });

    const response = await revokeOne(request(), {
      params: Promise.resolve({ id: 'other-session' }),
    });

    expect(response.status).toBe(404);
    expect(mocks.revokeSession).not.toHaveBeenCalled();
  });

  it('allows an admin to revoke another user session', async () => {
    mocks.requireUser.mockResolvedValue(auth('admin'));
    mocks.findUnique.mockResolvedValue({
      id: 'other-session',
      revokedAt: null,
      userId: 'user-2',
    });

    const response = await revokeOne(request(), {
      params: Promise.resolve({ id: 'other-session' }),
    });

    expect(response.status).toBe(200);
    expect(mocks.revokeSession).toHaveBeenCalledWith('other-session');
    // Another browser's session: this one is not signed out.
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it('revokes only the caller own non-current sessions in bulk', async () => {
    const response = await revokeOthers(request());

    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        revokedAt: null,
        userId: 'user-1',
        NOT: { id: 'session-current' },
      },
      data: { revokedAt: expect.any(Date) },
    });
    expect(mocks.apiTokenDeleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
    await expect(response.json()).resolves.toEqual({ revoked: 2, apiTokensRevoked: 1 });
  });
});
