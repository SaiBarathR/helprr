import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  revokeSession: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
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

  it('revokes the current session and clears its cookie', async () => {
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
  });

  it('revokes only the caller own non-current sessions in bulk', async () => {
    const response = await revokeOthers();

    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        revokedAt: null,
        userId: 'user-1',
        NOT: { id: 'session-current' },
      },
      data: { revokedAt: expect.any(Date) },
    });
    await expect(response.json()).resolves.toEqual({ revoked: 2 });
  });
});
