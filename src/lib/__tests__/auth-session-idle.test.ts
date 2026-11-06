import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  jwtVerify: vi.fn(),
  sessionFindUnique: vi.fn(),
  sessionUpdate: vi.fn(),
  sessionUpdateMany: vi.fn(),
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
      updateMany: mocks.sessionUpdateMany,
    },
  },
}));

import { requireUser, revokeSession } from '@/lib/auth';
import { SESSION_IDLE_TIMEOUT_SECONDS } from '@/lib/session-policy';

const NOW = new Date('2026-11-06T12:00:00Z').getTime();
const MINUTE = 60 * 1000;
const IDLE_MS = SESSION_IDLE_TIMEOUT_SECONDS * 1000;

// auth.ts keeps a per-process debounce map keyed by session id, so each test
// uses its own id.
function useSession(sid: string, lastSeenAt: Date) {
  mocks.jwtVerify.mockResolvedValue({ payload: { sid } });
  mocks.sessionFindUnique.mockResolvedValue({
    id: sid,
    createdAt: new Date(NOW - 20 * 24 * 60 * MINUTE),
    lastSeenAt,
    userAgent: null,
    ip: null,
    label: null,
    revokedAt: null,
    userId: 'user-1',
    user: { id: 'user-1', role: 'member', status: 'active' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  mocks.cookies.mockResolvedValue({ get: () => ({ value: 'signed-token' }) });
  mocks.sessionUpdate.mockResolvedValue({});
  mocks.sessionUpdateMany.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('session idle expiry', () => {
  it('rejects an idle session with 401 and revokes it', async () => {
    useSession('idle', new Date(NOW - IDLE_MS - MINUTE));

    const result = await requireUser();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
    expect(mocks.sessionUpdateMany).toHaveBeenCalledWith({
      where: { id: 'idle', revokedAt: null },
      data: { revokedAt: new Date(NOW) },
    });
    // An expired session is never touched back to life.
    expect(mocks.sessionUpdate).not.toHaveBeenCalled();
  });

  it('still rejects the idle session when recording the revoke fails', async () => {
    useSession('idle-db-down', new Date(NOW - IDLE_MS - MINUTE));
    mocks.sessionUpdateMany.mockRejectedValue(new Error('db down'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await requireUser();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
    error.mockRestore();
  });

  it('accepts a session idle for exactly the timeout and rejects one a millisecond past it', async () => {
    useSession('boundary', new Date(NOW - IDLE_MS));
    expect((await requireUser()).ok).toBe(true);

    useSession('past-boundary', new Date(NOW - IDLE_MS - 1));
    expect((await requireUser()).ok).toBe(false);
  });

  it('revokeSession treats a session retention already removed as revoked', async () => {
    mocks.sessionUpdateMany.mockResolvedValue({ count: 0 });

    await expect(revokeSession('swept')).resolves.toBeUndefined();
    expect(mocks.sessionUpdateMany).toHaveBeenCalledWith({
      where: { id: 'swept', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('accepts a session used just inside the idle window and extends it', async () => {
    useSession('nearly-idle', new Date(NOW - IDLE_MS + MINUTE));

    const result = await requireUser();

    expect(result.ok).toBe(true);
    expect(mocks.sessionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.sessionUpdate).toHaveBeenCalledWith({
      where: { id: 'nearly-idle' },
      data: { lastSeenAt: new Date(NOW) },
    });
  });

  it('writes lastSeenAt at most once per debounce window', async () => {
    useSession('busy', new Date(NOW - 10 * MINUTE));

    await requireUser();
    vi.setSystemTime(NOW + MINUTE);
    await requireUser();
    vi.setSystemTime(NOW + 2 * MINUTE);
    await requireUser();

    expect(mocks.sessionUpdate).toHaveBeenCalledTimes(1);

    // Once the window has passed, the next request writes again.
    vi.setSystemTime(NOW + 6 * MINUTE);
    await requireUser();
    expect(mocks.sessionUpdate).toHaveBeenCalledTimes(2);
    expect(mocks.sessionUpdate).toHaveBeenLastCalledWith({
      where: { id: 'busy' },
      data: { lastSeenAt: new Date(NOW + 6 * MINUTE) },
    });
  });

  it('does not write lastSeenAt for a session seen a moment ago', async () => {
    useSession('fresh', new Date(NOW - MINUTE));

    const result = await requireUser();

    expect(result.ok).toBe(true);
    expect(mocks.sessionUpdate).not.toHaveBeenCalled();
  });
});
