import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  authenticateByName: vi.fn(),
  connectionFindFirst: vi.fn(),
  userUpdate: vi.fn(),
  storeJellyfinToken: vi.fn(),
  invalidateJellyfinToken: vi.fn(),
  recordUsernameFailure: vi.fn(),
  recordGlobalLoginFailure: vi.fn(),
  readJellyfinToken: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/jellyfin-client', () => ({
  JellyfinClient: { authenticateByName: mocks.authenticateByName },
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    serviceConnection: { findFirst: mocks.connectionFindFirst },
    user: { update: mocks.userUpdate },
  },
}));
vi.mock('@/lib/jellyfin-token', () => ({
  storeJellyfinToken: mocks.storeJellyfinToken,
  invalidateJellyfinToken: mocks.invalidateJellyfinToken,
  readJellyfinToken: mocks.readJellyfinToken,
}));
vi.mock('@/lib/login-rate-limit', () => ({
  getClientIp: () => '10.0.0.1',
  enforceLoginRateLimit: vi.fn().mockResolvedValue(null),
  clearLoginAttempts: vi.fn().mockResolvedValue(undefined),
  enforceUsernameBackoff: vi.fn().mockResolvedValue(null),
  recordUsernameFailure: mocks.recordUsernameFailure,
  clearUsernameBackoff: vi.fn().mockResolvedValue(undefined),
  enforceGlobalLoginBackstop: vi.fn().mockResolvedValue(null),
  recordGlobalLoginFailure: mocks.recordGlobalLoginFailure,
  enforceMalformedLoginBackstop: vi.fn().mockResolvedValue(null),
  recordMalformedLoginRequest: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));

import { DELETE, GET, POST } from '@/app/api/account/jellyfin/link/route';

function request(body: unknown = { username: 'sai', password: 'pw' }) {
  return new NextRequest('http://localhost/api/account/jellyfin/link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function signedInAs(jellyfinUserId: string | null) {
  mocks.requireUser.mockResolvedValue({
    ok: true,
    user: { id: 'helprr-1', role: 'member', jellyfinUserId },
  });
}

describe('POST /api/account/jellyfin/link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connectionFindFirst.mockResolvedValue({ url: 'http://jf.local' });
    mocks.userUpdate.mockResolvedValue({});
    mocks.storeJellyfinToken.mockResolvedValue(undefined);
  });

  it('rejects an unauthenticated caller', async () => {
    mocks.requireUser.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.authenticateByName).not.toHaveBeenCalled();
  });

  it('connects when the credentials match the linked Jellyfin account', async () => {
    signedInAs('jf-sai');
    mocks.authenticateByName.mockResolvedValue({
      ok: true, userId: 'jf-sai', accessToken: 'tok', userName: 'sai',
    });
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connected: true, jellyfinUsername: 'sai' });
    expect(mocks.storeJellyfinToken).toHaveBeenCalledWith('helprr-1', 'tok');
  });

  it('refuses credentials for a different Jellyfin account and stores nothing', async () => {
    signedInAs('jf-sai');
    mocks.authenticateByName.mockResolvedValue({
      ok: true, userId: 'jf-someone-else', accessToken: 'tok', userName: 'other',
    });
    const res = await POST(request());
    expect(res.status).toBe(409);
    expect(mocks.storeJellyfinToken).not.toHaveBeenCalled();
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });

  it('auto-links a member who has no Jellyfin account yet', async () => {
    signedInAs(null);
    mocks.authenticateByName.mockResolvedValue({
      ok: true, userId: 'jf-new', accessToken: 'tok', userName: 'newbie',
    });
    expect((await POST(request())).status).toBe(200);
    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: 'helprr-1' },
      data: { jellyfinUserId: 'jf-new' },
    });
    expect(mocks.storeJellyfinToken).toHaveBeenCalledWith('helprr-1', 'tok');
  });

  it('refuses to auto-link a Jellyfin account another profile already claims', async () => {
    signedInAs(null);
    mocks.authenticateByName.mockResolvedValue({
      ok: true, userId: 'jf-taken', accessToken: 'tok', userName: 'taken',
    });
    const { Prisma } = await import('@prisma/client');
    mocks.userUpdate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: '6' }),
    );
    const res = await POST(request());
    expect(res.status).toBe(409);
    expect(mocks.storeJellyfinToken).not.toHaveBeenCalled();
  });

  it('maps a bad Jellyfin password to 401 and records the failure', async () => {
    signedInAs('jf-sai');
    mocks.authenticateByName.mockResolvedValue({ ok: false, reason: 'invalid_credentials' });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.recordUsernameFailure).toHaveBeenCalled();
    expect(mocks.recordGlobalLoginFailure).toHaveBeenCalled();
    expect(mocks.storeJellyfinToken).not.toHaveBeenCalled();
  });

  it('maps an unreachable Jellyfin to 502 without recording a failed attempt', async () => {
    signedInAs('jf-sai');
    mocks.authenticateByName.mockResolvedValue({ ok: false, reason: 'unavailable' });
    expect((await POST(request())).status).toBe(502);
    expect(mocks.recordUsernameFailure).not.toHaveBeenCalled();
  });

  it('502s when no Jellyfin connection is configured', async () => {
    signedInAs('jf-sai');
    mocks.connectionFindFirst.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(502);
    expect(mocks.authenticateByName).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/account/jellyfin/link', () => {
  beforeEach(() => vi.clearAllMocks());

  it('drops the token but keeps the identity link', async () => {
    signedInAs('jf-sai');
    mocks.invalidateJellyfinToken.mockResolvedValue(undefined);
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(mocks.invalidateJellyfinToken).toHaveBeenCalledWith('helprr-1');
    expect(mocks.userUpdate).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated caller', async () => {
    mocks.requireUser.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    expect((await DELETE()).status).toBe(401);
    expect(mocks.invalidateJellyfinToken).not.toHaveBeenCalled();
  });
});

describe('GET /api/account/jellyfin/link', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports connected when a usable token decrypts', async () => {
    signedInAs('jf-sai');
    mocks.readJellyfinToken.mockReturnValue('a-token');
    expect(await (await GET()).json()).toEqual({ connected: true });
  });

  it('reports disconnected when the token is gone — how the player tells a revoked token from a broken file', async () => {
    signedInAs('jf-sai');
    mocks.readJellyfinToken.mockReturnValue(null);
    expect(await (await GET()).json()).toEqual({ connected: false });
  });

  it('rejects an unauthenticated caller', async () => {
    mocks.requireUser.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    expect((await GET()).status).toBe(401);
    expect(mocks.readJellyfinToken).not.toHaveBeenCalled();
  });
});
