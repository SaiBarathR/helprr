import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  jwtVerify: vi.fn(),
  sessionFindUnique: vi.fn(),
  sessionUpdate: vi.fn(),
}));

vi.mock('react', () => ({ cache: (fn: unknown) => fn }));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('jose', () => ({
  jwtVerify: mocks.jwtVerify,
  SignJWT: class SignJWT {},
}));
vi.mock('@/lib/jwt-secret', () => ({ getJwtSecret: () => new Uint8Array(32) }));
vi.mock('@/lib/db', () => ({
  prisma: {
    session: {
      findUnique: mocks.sessionFindUnique,
      update: mocks.sessionUpdate,
    },
  },
}));

import { requireAdmin, requireUserCapability, verifySession } from '@/lib/auth';

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    username: 'user',
    displayName: 'User',
    passwordHash: 'stored-hash',
    role: 'member',
    status: 'active',
    template: 'member',
    permissions: {},
    jellyfinUserId: null,
    seerrUserId: null,
    jellyfinToken: null,
    createdAt: new Date('2026-07-14T00:00:00Z'),
    updatedAt: new Date('2026-07-14T00:00:00Z'),
    ...overrides,
  };
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    createdAt: new Date('2026-07-14T00:00:00Z'),
    lastSeenAt: new Date(),
    userAgent: null,
    ip: null,
    label: null,
    revokedAt: null,
    userId: 'user-1',
    user: user(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookies.mockResolvedValue({ get: () => ({ value: 'signed-token' }) });
  mocks.jwtVerify.mockResolvedValue({ payload: { sid: 'session-1', role: 'admin' } });
  mocks.sessionUpdate.mockResolvedValue({});
});

describe('server-side session and role enforcement', () => {
  it('ignores the JWT role hint and applies a database demotion on the next request', async () => {
    mocks.sessionFindUnique.mockResolvedValue(session({ user: user({ role: 'member' }) }));

    const result = await requireAdmin();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it('applies current database capability overrides on every request', async () => {
    mocks.sessionFindUnique
      .mockResolvedValueOnce(session({ user: user() }))
      .mockResolvedValueOnce(
        session({ user: user({ permissions: { 'series.delete': true } }) }),
      );

    const denied = await requireUserCapability('series.delete');
    const allowed = await requireUserCapability('series.delete');

    expect(denied.ok).toBe(false);
    expect(allowed.ok).toBe(true);
  });

  it.each([
    ['revoked session', session({ revokedAt: new Date() })],
    ['disabled user', session({ user: user({ status: 'disabled' }) })],
    ['pending user', session({ user: user({ status: 'pending' }) })],
  ])('rejects a %s immediately', async (_label, row) => {
    mocks.sessionFindUnique.mockResolvedValue(row);
    await expect(verifySession('signed-token')).resolves.toBe(false);
  });

  it('accepts an active, unrevoked session', async () => {
    mocks.sessionFindUnique.mockResolvedValue(session());
    await expect(verifySession('signed-token')).resolves.toBe(true);
  });
});
